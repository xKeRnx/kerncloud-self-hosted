import os from "node:os";
import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
  DescribeTaskDefinitionCommand,
  RunTaskCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import type { EnvironmentJob } from "./docker.ts";
type Sender = { send(command: any): Promise<any> };
export class AwsEcs {
  constructor(
    readonly hostId: string,
    readonly client: Sender = new ECSClient({ region: process.env.AWS_REGION }),
    readonly cluster = process.env.AWS_ECS_CLUSTER ?? "",
    readonly subnets = (process.env.AWS_ECS_SUBNETS ?? "")
      .split(",")
      .filter(Boolean),
    readonly groups = (process.env.AWS_ECS_SECURITY_GROUPS ?? "")
      .split(",")
      .filter(Boolean),
    readonly definitions: Record<string, string> = JSON.parse(
      process.env.AWS_ECS_TASK_DEFINITIONS ?? "{}",
    ),
    readonly environmentDefinitions: Record<string, string> = JSON.parse(
      process.env.AWS_ECS_ENVIRONMENT_DEFINITIONS ?? "{}",
    ),
  ) {}
  async tasks() {
    if (!this.cluster) throw new Error("AWS-ECS-Cluster fehlt.");
    const found = await this.client.send(
      new ListTasksCommand({
        cluster: this.cluster,
        startedBy: `kc-${this.hostId.replaceAll("-", "")}`,
      }),
    );
    if (!found.taskArns?.length) return [];
    const result = await this.client.send(
      new DescribeTasksCommand({
        cluster: this.cluster,
        tasks: found.taskArns.slice(0, 100),
        include: ["TAGS"],
      }),
    );
    return (result.tasks ?? []).filter((t: any) =>
      t.tags?.some(
        (tag: any) => tag.key === "kerncloud.host" && tag.value === this.hostId,
      ),
    );
  }
  async inventory() {
    const tasks = await this.tasks();
    return {
      version: "AWS ECS/Fargate",
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      memoryTotal: os.totalmem(),
      memoryFree: os.freemem(),
      load: os.loadavg(),
      commandsEnabled: process.env.INFRA_ALLOW_COMMANDS === "true",
      containers: tasks.map((t: any) => ({
        id: t.taskArn,
        name: t.taskArn.split("/").at(-1),
        image: t.taskDefinitionArn,
        state: String(t.lastStatus ?? "UNKNOWN").toLowerCase(),
        health: String(t.healthStatus ?? "UNKNOWN").toLowerCase(),
        environmentId:
          t.tags?.find((x: any) => x.key === "kerncloud.environment")?.value ??
          null,
        cpuPercent: null,
        memoryBytes: null,
        startedAt: t.startedAt?.toISOString() ?? null,
      })),
    };
  }
  async execute(
    job: EnvironmentJob,
    assertLease: () => Promise<void> = async () => {},
  ) {
    const all = await this.tasks(),
      owned = all.filter((t: any) =>
        t.tags?.some(
          (x: any) =>
            x.key === "kerncloud.environment" && x.value === job.environmentId,
        ),
      );
    const current = owned.find((t: any) =>
      t.tags?.some(
        (x: any) =>
          x.key === "kerncloud.generation" &&
          x.value === String(job.generation),
      ),
    );
    if (["stop", "delete", "reset"].includes(job.action))
      for (const t of owned) {
        if (job.action === "reset" && t === current) continue;
        if (t.lastStatus !== "STOPPED") {
          await assertLease();
          await this.client.send(
            new StopTaskCommand({
              cluster: this.cluster,
              task: t.taskArn,
              reason: `KeRnCloud ${job.action}`,
            }),
          );
          let stopped = false;
          for (let n = 0; n < 36; n++) {
            await assertLease();
            const result = await this.client.send(
              new DescribeTasksCommand({
                cluster: this.cluster,
                tasks: [t.taskArn],
              }),
            );
            if (result.tasks?.[0]?.lastStatus === "STOPPED") {
              stopped = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 5000));
          }
          if (!stopped)
            throw new Error(
              "AWS bestätigt das Stoppen noch nicht; Ausgang abgleichen.",
            );
        }
      }
    if (job.action === "stop" || job.action === "delete")
      return { resourceId: current?.taskArn ?? null, endpoint: null };
    if (current && current.lastStatus !== "STOPPED")
      return { resourceId: current.taskArn, endpoint: null };
    const definition =
      this.environmentDefinitions[job.environmentId] ??
      this.definitions[job.spec.id];
    if (!definition || !this.subnets.length || !this.groups.length)
      throw new Error(
        "AWS-Vorlage, private Subnetze und Security Groups müssen auf dem Betreiber-Connector eingerichtet sein.",
      );
    const info = await this.client.send(
      new DescribeTaskDefinitionCommand({ taskDefinition: definition }),
    );
    const td = info.taskDefinition;
    if (
      td?.volumes?.some((v: any) => v.efsVolumeConfiguration) &&
      !this.environmentDefinitions[job.environmentId]
    )
      throw new Error(
        "EFS erfordert eine eigene Taskdefinition und einen getrennten Access Point pro Kundenumgebung.",
      );
    if (
      !td?.requiresCompatibilities?.includes("FARGATE") ||
      td.networkMode !== "awsvpc" ||
      Number(td.cpu) !== job.spec.cpu * 1024 ||
      Number(td.memory) !== job.spec.memory_mb ||
      td.containerDefinitions?.some(
        (c: any) =>
          c.privileged ||
          !c.readonlyRootFilesystem ||
          !c.user ||
          /^0(:|$)/.test(c.user),
      )
    )
      throw new Error(
        "AWS-Taskdefinition stimmt nicht mit Ressourcen und Isolationsvorgaben der Vorlage überein.",
      );
    await assertLease();
    const result = await this.client.send(
      new RunTaskCommand({
        cluster: this.cluster,
        taskDefinition: definition,
        launchType: "FARGATE",
        count: 1,
        clientToken: job.id,
        startedBy: `kc-${this.hostId.replaceAll("-", "")}`,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: this.subnets,
            securityGroups: this.groups,
            assignPublicIp: "DISABLED",
          },
        },
        tags: [
          { key: "kerncloud.host", value: this.hostId },
          { key: "kerncloud.environment", value: job.environmentId },
          { key: "kerncloud.generation", value: String(job.generation) },
          { key: "kerncloud.job", value: job.id },
        ],
      }),
    );
    if (result.failures?.length || !result.tasks?.[0]?.taskArn)
      throw new Error(
        "AWS hat die Bereitstellung abgelehnt. ECS-Ereignisse beim Betreiber prüfen.",
      );
    return {
      resourceId: result.tasks[0].taskArn,
      endpoint: null,
      resourceState: "starting",
    };
  }
}
