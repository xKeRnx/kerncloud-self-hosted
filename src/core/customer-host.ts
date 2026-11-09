import type { EnvironmentJob } from "../infrastructure/docker.ts";
export function validateCustomerJob(job: EnvironmentJob) {
  const s = job.spec;
  if (
    !["browser", "development"].includes(s.id) ||
    ![`kerncloud-${s.id}:0.3`, `kerncloud-${s.id}:0.4`].includes(s.image) ||
    s.command.length ||
    s.user_id !== "1000:1000" ||
    !s.read_only ||
    !Number.isInteger(s.cpu) ||
    s.cpu < 1 ||
    s.cpu > 8 ||
    !Number.isInteger(s.memory_mb) ||
    s.memory_mb < 64 ||
    s.memory_mb > 16384
  )
    throw Error("Local connector policy rejected this template.");
}
