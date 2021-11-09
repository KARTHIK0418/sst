package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net"
	"net/url"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/google/uuid"
	"github.com/pion/stun"
	"golang.org/x/net/websocket"
)

var SUBS = map[string]chan interface{}{
	"ping":     make(chan interface{}),
	"response": make(chan interface{}),
}

var MAX_PACKET_SIZE = 1024 * 24

var CONN, BRIDGE, SELF = (func() (*net.UDPConn, *net.UDPAddr, *net.UDPAddr) {
	local, _ := net.ResolveUDPAddr("udp", ":10280")
	bridge, _ := net.ResolveUDPAddr("udp", os.Getenv("SST_DEBUG_BRIDGE"))
	conn, _ := net.ListenUDP("udp", local)
	log.Println("Listening...")
	self := discover(conn)
	register(self)
	go ping(conn, bridge)
	go read(conn)
	log.Println("Waiting for first ping")
	<-SUBS["ping"]
	go func() {
		for {
			<-SUBS["ping"]
		}
	}()

	return conn, bridge, self
})()

func discover(conn *net.UDPConn) *net.UDPAddr {
	server, _ := net.ResolveUDPAddr("udp", "stun.l.google.com:19302")
	message := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
	conn.WriteToUDP(message.Raw, server)
	for {
		buf := make([]byte, 1024)

		n, _, _ := conn.ReadFromUDP(buf)
		buf = buf[:n]
		if stun.IsMessage(buf) {
			m := new(stun.Message)
			m.Raw = buf
			decErr := m.Decode()
			if decErr != nil {
				log.Println("decode:", decErr)
				break
			}
			var xorAddr stun.XORMappedAddress
			if getErr := xorAddr.GetFrom(m); getErr != nil {
				panic("Failed to get NAT address")
			}
			addr, _ := net.ResolveUDPAddr("udp", xorAddr.String())
			return addr
		}
	}
	panic("Failed to get NAT address")
}

func register(self *net.UDPAddr) {
	log.Println("Registering", self)
	endpoint, _ := url.Parse(os.Getenv("SST_DEBUG_ENDPOINT"))
	conn, err := websocket.Dial(endpoint.String(), "", "http://"+endpoint.Host)
	if err != nil {
		panic(err)
	}
	defer conn.Close()
	err = websocket.JSON.Send(conn, map[string]interface{}{
		"action": "register",
		"body": map[string]interface{}{
			"host": self.IP.String(),
			"port": self.Port,
		},
	})
	if err != nil {
		panic(err)
	}
	conn.Close()
}

type Message struct {
	Type string      `json:"type"`
	Body interface{} `json:"body"`
}

func write(conn *net.UDPConn, to *net.UDPAddr, msg *Message) {
	json, _ := json.Marshal(msg)
	chunks := []string{""}
	for _, c := range json {
		last := len(chunks) - 1
		chunks[last] = chunks[last] + string(c)
		if len(chunks[last]) > MAX_PACKET_SIZE {
			chunks = append(chunks, "")
		}
	}
	length := len(chunks)
	id := uuid.New().String()[:4]
	b := new(bytes.Buffer)
	for index, chunk := range chunks {
		b.WriteString(id)
		b.WriteByte(byte(length))
		b.WriteByte(byte(index))
		b.WriteString(chunk)
		conn.WriteToUDP(b.Bytes(), to)
		b.Reset()
	}
}

func ping(conn *net.UDPConn, bridge *net.UDPAddr) *Message {
	for {
		write(conn, bridge, &Message{
			Type: "ping",
			Body: "hello",
		})
		time.Sleep(time.Second * 1)
	}
}

func read(conn *net.UDPConn) *Message {
	windows := map[string][][]byte{}
out:
	for {
		buffer := make([]byte, 65535)
		read, _, _ := conn.ReadFromUDP(buffer)
		id := string(buffer[:4])
		cache, exists := windows[id]
		if !exists {
			length := int(buffer[4])
			cache = make([][]byte, length)
			windows[id] = cache
		}
		index := int(buffer[5])
		cache[index] = buffer[6:read]

		joined := new(bytes.Buffer)
		for _, item := range cache {
			if item == nil {
				continue out
			}
			joined.Write(item)
		}
		msg := new(Message)
		json.Unmarshal(joined.Bytes(), msg)
		delete(windows, id)
		c := SUBS[msg.Type]
		c <- msg.Body

	}
}

func Handler(request interface{}) (interface{}, error) {
	log.Println("Sending from", SELF, "to", BRIDGE)
	write(CONN, BRIDGE, &Message{
		Type: "request",
		Body: request,
	})
	log.Println("Waiting for response")
	data := <-SUBS["response"]
	return data, nil
}

func main() {
	lambda.Start(Handler)
}
