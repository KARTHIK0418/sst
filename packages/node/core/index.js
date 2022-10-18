const ENV_PREFIX = "SST_Table_name_";
export const Table = new Proxy({}, {
    get(target, prop, receiver) {
        if (!(prop in target)) {
            throw new Error(`Cannot use Table.${String(prop)}. Please make sure it is bound to this function.`);
        }
        return Reflect.get(target, prop, receiver);
    }
});
parseEnvironment();
function parseEnvironment() {
    Object.keys(process.env)
        .filter((key) => key.startsWith(ENV_PREFIX))
        .forEach((key) => {
        const name = envNameToTypeName(key);
        // @ts-ignore
        Table[name] = {
            url: process.env[key]
        };
    });
}
function envNameToTypeName(envName) {
    return envName.replace(new RegExp(`^${ENV_PREFIX}`), "");
}
