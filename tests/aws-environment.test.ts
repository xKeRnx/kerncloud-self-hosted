import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AwsEcs } from "../src/infrastructure/aws.ts";
test("AWS-Adapter begrenzt Aktionen auf eigene Tags und nutzt eine stabile RunTask-Idempotenzkennung", async () => {
  const host = randomUUID(),
    environmentId = randomUUID(),
    calls: any[] = [];
  let stopped = false;
  const client = {
    async send(command: any) {
      calls.push(command);
      switch (command.constructor.name) {
        case "ListTasksCommand":
          return { taskArns: ["own", "foreign"] };
        case "DescribeTasksCommand":
          return {
            tasks: [
              {
                taskArn: "own",
                lastStatus: stopped ? "STOPPED" : "RUNNING",
                tags: [
                  { key: "kerncloud.host", value: host },
                  { key: "kerncloud.environment", value: environmentId },
                  { key: "kerncloud.generation", value: "1" },
                ],
              },
              {
                taskArn: "foreign",
                lastStatus: "RUNNING",
                tags: [{ key: "kerncloud.host", value: "another" }],
              },
            ],
          };
        case "StopTaskCommand":
          stopped = true;
          return {};
        case "DescribeTaskDefinitionCommand":
          return {
            taskDefinition: {
              requiresCompatibilities: ["FARGATE"],
              networkMode: "awsvpc",
              cpu: "1024",
              memory: "2048",
              containerDefinitions: [
                { user: "1000:1000", readonlyRootFilesystem: true },
              ],
            },
          };
        case "RunTaskCommand":
          return { tasks: [{ taskArn: "new-owned" }] };
        default:
          return {};
      }
    },
  };
  const aws = new AwsEcs(
    host,
    client,
    "cluster",
    ["private-subnet"],
    ["dedicated-security-group"],
    { dev: "approved-definition" },
  );
  const job = {
    id: randomUUID(),
    environmentId,
    lease: randomUUID(),
    generation: 2,
    action: "reset" as const,
    spec: {
      id: "dev",
      image: "approved",
      command: [],
      cpu: 1,
      memory_mb: 2048,
      container_port: 0,
      network: false,
      user_id: "1000:1000",
      read_only: true,
    },
  };
  const result = await aws.execute(job);
  assert.equal(result.resourceId, "new-owned");
  assert.deepEqual(
    calls
      .filter((c) => c.constructor.name === "StopTaskCommand")
      .map((c) => c.input.task),
    ["own"],
  );
  const run = calls.find((c) => c.constructor.name === "RunTaskCommand");
  assert.equal(run.input.clientToken, job.id);
  assert.equal(
    run.input.networkConfiguration.awsvpcConfiguration.assignPublicIp,
    "DISABLED",
  );
  assert.equal(run.input.launchType, "FARGATE");
  assert.equal(run.input.taskDefinition, "approved-definition");
});
