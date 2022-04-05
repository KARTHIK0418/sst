import path from "path";
import glob from "glob";
import * as fs from "fs-extra";
import * as crypto from "crypto";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { App } from "./App";
import { getFunctionRef, SSTConstruct } from "./Construct";
import { Function as Fn } from "./Function";

/////////////////////
// Interfaces
/////////////////////

export interface RDSProps {
  /**
   * Additional properties for the cluster.
   */
  rdsServerlessCluster?: RDSCdkServerlessClusterProps;

  /**
   * Database engine of the cluster.
   */
  engine: RDSEngineType;

  /**
   * Name of a database which is automatically created inside the cluster
   */
  defaultDatabaseName: string;

  /**
   * Scaling configuration of the cluster.
   *
   * @default - The cluster is automatically paused after 5 minutes of being idle.
   * minimum capacity: 2 ACU
   * maximum capacity: 16 ACU
   */
  scaling?: RDSScalingProps;

  /**
   * Path to the directory that contains the migration scripts.
   *
   * @default Migrations not automatically run on deploy.
   */
  migrations?: string;
}

export interface RDSScalingProps {
  /**
   * The time before the cluster is paused.
   *
   * Pass in true to pause after 5 minutes of inactive. And pass in false to
   * disable pausing.
   *
   * Or pass in the number of minutes to wait before the cluster is paused.
   *
   * @default - true
   */
  autoPause?: boolean | number;

  /**
   * The minimum capacity for the cluster.
   *
   * @default - ACU_2
   */
  minCapacity?: keyof typeof rds.AuroraCapacityUnit;

  /**
   * The maximum capacity for the cluster.
   *
   * @default - ACU_16
   */
  maxCapacity?: keyof typeof rds.AuroraCapacityUnit;
}

export type RDSEngineType = "mysql5.6" | "mysql5.7" | "postgresql10.14";

export interface RDSCdkServerlessClusterProps
  extends Omit<
    rds.ServerlessClusterProps,
    "vpc" | "engine" | "defaultDatabaseName" | "scaling"
  > {
  readonly vpc?: ec2.IVpc;
}

/////////////////////
// Construct
/////////////////////

/**
 * The `RDS` construct is a higher level CDK construct that makes it easy to create an [RDS Serverless Cluster](https://aws.amazon.com/rds/). It uses the following defaults:
 * - Defaults to using the [Serverless v1 On-Demand autoscaling configuration](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.html) to make it serverless.
 * - Provides a built-in interface for running schema migrations using [Kysely](https://koskimas.github.io/kysely/#migrations).
 * - Enables [Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html) to allow your Lambda functions to access the database cluster without needing to deploy the functions in a VPC (virtual private cloud).
 * - Enables [Backup Snapshot](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/BackupRestoreAurora.html) to make sure that you don't lose your data.
 *
 * @example
 * ### Use the minimal config
 * ```js
 * import { RDS } from "@serverless-stack/resources";
 *
 * new RDS(this, "Database", {
 *   engine: "postgresql10.14",
 *   defaultDatabaseName: "my_database",
 * });
 * ```
 *
 * ### Configuring auto-scaling
 *
 * RDS automatically scales the cluster size based on CPU utilization, connections, and available memory. An RDS with the MySQL engine can scale from 1 to 256 ACU (Aurora capacity unit). And an RDS with the PostgreSQL engine can scale from 2 to 384 ACU. You can specify the minimum and maximum range for the cluster. The default minimum and maximum capacity are 2 and 16 ACU.
 *
 * You can also choose to pause your RDS cluster after a given amount of time with no activity. When the cluster is paused, you are charged only for the storage. If database connections are requested when a cluster is paused, the cluster automatically resumes. By default, the cluster auto-pauses after 5 minutes of inactivity.
 *
 * For dev stages, it makes sense to pick a low capacity and auto-pause time. And disable it for production stages.
 *
 * ```js
 * import * as cdk from "aws-cdk-lib";
 * import * as rds from "aws-cdk-lib/aws-rds";
 *
 * const prodConfig = {
 *   autoPause: false,
 *   minCapacity: "ACU_8",
 *   maxCapacity: "ACU_64",
 * };
 * const devConfig = {
 *   autoPause: true,
 *   minCapacity: "ACU_2",
 *   maxCapacity: "ACU_2",
 * };
 *
 * new RDS(this, "Database", {
 *   engine: "postgresql10.14",
 *   defaultDatabaseName: "acme",
 *   scaling: app.stage === "prod" ? prodConfig : devConfig,
 * });
 * ```
 *
 *[Read more](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.how-it-works.html#aurora-serverless.how-it-works.auto-scaling) over on the RDS docs.
 *
 * ### Configuring migrations
 * ```js
 * new RDS(this, "Database", {
 *   engine: "postgresql10.14",
 *   defaultDatabaseName: "acme",
 *   migrations: "path/to/migration/scripts",
 * });
 * ```
 *
 * The `RDS` construct uses [Kysely](https://koskimas.github.io/kysely/) to run and manage schema migrations. The `migrations` prop should point to the folder where your migration files are.
 *
 * On `sst deploy`, all migrations that have not yet been run will be run as a part of the deploy process. The migrations are executed in alphabetical order by their name.
 *
 * On `sst start`, migrations are not automatically run. You can manually run them via the [SST Console](../console.md).
 *
 * :::note
 * New migrations must always have a name that comes alphabetically after the last executed migration.
 * :::
 *
 * Migration files should have the following format.
 *
 * ```js
 * async function up(db) {
 *   // Migration code
 * }
 *
 * async function down(db) {
 *   // Migration code
 * }
 *
 * module.exports = { up, down };
 * ```
 *
 * For example:
 *
 * #### PostgreSQL migration example
 *
 * ```js
 * async function up(db) {
 *   await db.schema
 *     .createTable("person")
 *     .addColumn("id", "serial", (col) => col.primaryKey())
 *     .addColumn("first_name", "varchar", (col) => col.notNull())
 *     .addColumn("last_name", "varchar")
 *     .addColumn("gender", "varchar(50)", (col) => col.notNull())
 *     .execute()
 * }
 *
 * async function down(db) {
 *   await db.schema.dropTable("person").execute()
 * }
 *
 * module.exports = { up, down };
 * ```
 *
 * #### MySQL migration example
 *
 * ```js
 * async function up(db) {
 *   await db.schema
 *     .createTable("person")
 *     .addColumn("id", "integer", (col) => col.autoIncrement().primaryKey())
 *     .addColumn("first_name", "varchar(255)", (col) => col.notNull())
 *     .addColumn("last_name", "varchar(255)")
 *     .addColumn("gender", "varchar(50)", (col) => col.notNull())
 *     .execute()
 * }
 *
 * async function down(db) {
 *   await db.schema.dropTable("person").execute()
 * }
 *
 * module.exports = { up, down };
 * ```
 *
 * [Read more about writing migrations](https://koskimas.github.io/kysely/#migrations) over on the Kysely docs.
 *
 * ### Configuring the RDS cluster
 *
 * You can configure the internally created CDK `ServerlessCluster` instance.
 *
 * ```js {6-8}
 * import * as cdk from "aws-cdk-lib";
 *
 * new RDS(this, "Database", {
 *   engine: "postgresql10.14",
 *   defaultDatabaseName: "acme",
 *   rdsServerlessCluster: {
 *     backupRetention: cdk.Duration.days(7),
 *   },
 * });
 * ```
 *
 * ### Import an existing VPC
 *
 * The `RDS` construct automatically creates a VPC to deploy the cluster. This VPC contains only PRIVATE and ISOLATED subnets, without NAT Gateways.
 *
 * :::note
 * Since we are using the Data API, you don't need to deploy your Lambda functions into the RDS's VPC.
 * :::
 *
 * Yo can override the internally created `VPC` instance.
 *
 * ```js {7-12}
 * import * as ec2 from "aws-cdk-lib/aws-ec2";
 *
 * new RDS(this, "Database", {
 *   engine: "postgresql10.14",
 *   defaultDatabaseName: "acme",
 *   rdsServerlessCluster: {
 *     vpc: ec2.Vpc.fromLookup(this, "VPC", {
 *       vpcId: "vpc-xxxxxxxxxx",
 *     }),
 *     vpcSubnets: {
 *       subnetType: ec2.SubnetType.PRIVATE,
 *     },
 *   },
 * });
 * ```
 */
export class RDS extends Construct implements SSTConstruct {
  /**
   * The internally created CDK ServerlessCluster instance.
   */
  public readonly rdsServerlessCluster: rds.ServerlessCluster;
  /**
   * The internally created schema migration Function instance.
   */
  public readonly migratorFunction?: Fn;
  private readonly engine: string;
  private readonly defaultDatabaseName: string;

  constructor(scope: Construct, id: string, props: RDSProps) {
    super(scope, id);

    const app = scope.node.root as App;
    const {
      rdsServerlessCluster,
      engine,
      defaultDatabaseName,
      scaling,
      migrations,
    } = props || {};

    ////////////////////
    // Create Bucket
    ////////////////////

    const rdsServerlessClusterProps = (rdsServerlessCluster ||
      {}) as RDSCdkServerlessClusterProps;

    this.validateRDSServerlessClusterProps(rdsServerlessClusterProps);
    this.validateRequiredProps(props || {});

    this.engine = engine;
    this.defaultDatabaseName = defaultDatabaseName;
    this.rdsServerlessCluster = new rds.ServerlessCluster(this, "Cluster", {
      clusterIdentifier: app.logicalPrefixedName(id),
      ...rdsServerlessClusterProps,
      defaultDatabaseName,
      enableDataApi: true,
      engine: this.getEngine(engine),
      scaling: this.getScaling(scaling),
      vpc: this.getVpc(rdsServerlessClusterProps),
      vpcSubnets: this.getVpcSubnets(rdsServerlessClusterProps),
    });

    ///////////////////////////
    // Create Migrations
    ///////////////////////////

    if (migrations) {
      this.validateMigrationsFileExists(migrations);

      this.migratorFunction = this.createMigrationsFunction(
        engine,
        defaultDatabaseName,
        migrations
      );
      this.createMigrationCustomResource(migrations);
    }
  }

  /**
   * The ARN of the internally created CDK ServerlessCluster instance.
   */
  public get clusterArn(): string {
    return this.rdsServerlessCluster.clusterArn;
  }

  /**
   * The identifier of the internally created CDK ServerlessCluster instance.
   */
  public get clusterIdentifier(): string {
    return this.rdsServerlessCluster.clusterIdentifier;
  }

  /**
   * The endpoint of the internally created CDK ServerlessCluster instance.
   */
  public get clusterEndpoint(): rds.Endpoint {
    return this.rdsServerlessCluster.clusterEndpoint;
  }

  /**
   * The ARN of the internally created CDK Secret instance.
   */
  public get secretArn(): string {
    return this.rdsServerlessCluster.secret!.secretArn;
  }

  public getConstructMetadata() {
    return {
      type: "RDS" as const,
      data: {
        engine: this.engine,
        secretArn: this.secretArn,
        clusterArn: this.clusterArn,
        clusterIdentifier: this.clusterIdentifier,
        defaultDatabaseName: this.defaultDatabaseName,
        migrator:
          this.migratorFunction && getFunctionRef(this.migratorFunction),
      },
    };
  }

  private validateRDSServerlessClusterProps(
    props: RDSCdkServerlessClusterProps
  ) {
    // Validate "engine" is passed in from the top level
    if ((props as any).engine) {
      throw new Error(
        `Use "engine" instead of "rdsServerlessCluster.engine" to configure the RDS database engine.`
      );
    }

    // Validate "defaultDatabaseName" is passed in from the top level
    if ((props as any).defaultDatabaseName) {
      throw new Error(
        `Use "defaultDatabaseName" instead of "rdsServerlessCluster.defaultDatabaseName" to configure the RDS database engine.`
      );
    }

    // Validate "scaling" is passed in from the top level
    if ((props as any).scaling) {
      throw new Error(
        `Use "scaling" instead of "rdsServerlessCluster.scaling" to configure the RDS database auto-scaling.`
      );
    }

    // Validate "enableDataApi" is not passed in
    if (props.enableDataApi === false) {
      throw new Error(
        `Do not configure the "rdsServerlessCluster.enableDataApi". Data API is always enabled for this construct.`
      );
    }
  }

  private validateRequiredProps(props: RDSProps) {
    if (!props.engine) {
      throw new Error(`Missing "engine" in the "${this.node.id}" RDS`);
    }

    if (!props.defaultDatabaseName) {
      throw new Error(
        `Missing "defaultDatabaseName" in the "${this.node.id}" RDS`
      );
    }
  }

  private validateMigrationsFileExists(migrations: string) {
    if (!fs.existsSync(migrations))
      throw new Error(
        `Cannot find the migrations in "${path.resolve(migrations)}".`
      );
  }

  private getEngine(engine: RDSEngineType): rds.IClusterEngine {
    if (engine === "mysql5.6") {
      return rds.DatabaseClusterEngine.aurora({
        version: rds.AuroraEngineVersion.VER_10A,
      });
    } else if (engine === "mysql5.7") {
      return rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_2_07_1,
      });
    } else if (engine === "postgresql10.14") {
      return rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_10_14,
      });
    }

    throw new Error(
      `The specified "engine" is not supported for sst.RDS. Only mysql5.6, mysql5.7, and postgresql10.14 engines are currently supported.`
    );
  }

  private getScaling(scaling?: RDSScalingProps): rds.ServerlessScalingOptions {
    return {
      autoPause:
        scaling?.autoPause === false
          ? cdk.Duration.minutes(0)
          : scaling?.autoPause === true || scaling?.autoPause === undefined
          ? cdk.Duration.minutes(5)
          : cdk.Duration.minutes(scaling?.autoPause),
      minCapacity: rds.AuroraCapacityUnit[scaling?.minCapacity || "ACU_2"],
      maxCapacity: rds.AuroraCapacityUnit[scaling?.maxCapacity || "ACU_16"],
    };
  }

  private getVpc(props: RDSCdkServerlessClusterProps): ec2.IVpc {
    if (props.vpc) {
      return props.vpc;
    }

    return new ec2.Vpc(this, "vpc", {
      natGateways: 0,
    });
  }

  private getVpcSubnets(
    props: RDSCdkServerlessClusterProps
  ): ec2.SubnetSelection | undefined {
    if (props.vpc) {
      return props.vpcSubnets;
    }

    return {
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    };
  }

  private createMigrationsFunction(
    engine: string,
    defaultDatabaseName: string,
    migrations: string
  ) {
    const app = this.node.root as App;

    // path to migration scripts inside the Lambda function
    const migrationsDestination = "sst_rds_migration_scripts";

    // fullpath of the migrator Lambda function
    // Note:
    // - when invoked from `sst build`, __dirname is `resources/dist`
    // - when running resources tests, __dirname is `resources/src`
    // For now we will do `__dirname/../dist` to make both cases work.
    const srcPath = path.resolve(
      path.join(__dirname, "..", "dist", "RDS_migrator")
    );

    const fn = new Fn(this, "MigrationFunction", {
      srcPath,
      handler: "index.handler",
      runtime: "nodejs14.x",
      timeout: 900,
      memorySize: 1024,
      environment: {
        RDS_ARN: this.rdsServerlessCluster.clusterArn,
        RDS_SECRET: this.rdsServerlessCluster.secret!.secretArn,
        RDS_DATABASE: defaultDatabaseName,
        RDS_ENGINE_MODE: engine === "postgresql10.14" ? "postgres" : "mysql",
        // for live development, perserve the migrations path so the migrator
        // can locate the migration files
        RDS_MIGRATIONS_PATH: app.local ? migrations : migrationsDestination,
      },
      bundle: {
        // Note that we need to generate a relative path of the migrations off the
        // srcPath because sst.Function internally builds the copy "from" path by
        // joining the srcPath and the from path.
        copyFiles: [
          {
            from: path.relative(
              path.resolve(srcPath),
              path.resolve(migrations)
            ),
            to: migrationsDestination,
          },
        ],
      },
    });

    fn.attachPermissions([this.rdsServerlessCluster]);

    return fn;
  }

  private createMigrationCustomResource(migrations: string) {
    const app = this.node.root as App;

    // Create custom resource handler
    const handler = new lambda.Function(this, "MigrationHandler", {
      code: lambda.Code.fromAsset(path.join(__dirname, "Script")),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
    });
    this.migratorFunction?.grantInvoke(handler);

    // Note: "MigrationsHash" is generated to ensure the Custom Resource function
    //       is only run when migration files change.
    //
    //       Do not use the hash in Live mode, b/c we want the custom resource
    //       to remain the same in CloudFormation template when rebuilding
    //       infrastructure. Otherwise, there will always be a change when
    //       rebuilding infrastructure b/c the "BuildAt" property changes on
    //       each build.
    const hash = app.local ? 0 : this.generateMigrationsHash(migrations);
    new cdk.CustomResource(this, "MigrationResource", {
      serviceToken: handler.functionArn,
      resourceType: "Custom::SSTScript",
      properties: {
        UserCreateFunction: app.local
          ? undefined
          : this.migratorFunction?.functionName,
        UserUpdateFunction: app.local
          ? undefined
          : this.migratorFunction?.functionName,
        UserParams: JSON.stringify({}),
        MigrationsHash: hash,
      },
    });
  }

  private generateMigrationsHash(migrations: string): string {
    // Get all files inside the migrations folder
    const files = glob.sync("**", {
      dot: true,
      nodir: true,
      follow: true,
      cwd: migrations,
    });

    // Calculate hash of all files content
    return crypto
      .createHash("md5")
      .update(
        files
          .map((file) => fs.readFileSync(path.join(migrations, file)))
          .join("")
      )
      .digest("hex");
  }
}
