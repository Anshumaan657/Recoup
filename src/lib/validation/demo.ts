import { z } from "zod";

export const demoReplayRequestSchema = z
  .object({
    seed: z.number().int().positive().max(2_147_483_647).optional(),
    reset: z.boolean().optional(),
  })
  .strict();

export type DemoReplayRequest = z.infer<typeof demoReplayRequestSchema>;
