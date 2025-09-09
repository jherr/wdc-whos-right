import { os } from "@orpc/server";
import * as z from "zod";
import { v4 as uuidv4 } from "uuid";

import { aiResponse, setupSession, getSessionParticipants } from "@/engine";

export const setup = os.input(z.object({})).handler(() => {
  const id = uuidv4();
  setupSession(id);
  return id;
});

export const ask = os
  .input(z.object({ id: z.string(), prompt: z.string() }))
  .handler(({ input }) => {
    console.log("prompt", input.prompt);
    console.log("id", input.id);
    const response = aiResponse(input.prompt, input.id);
    return response;
  });

export const getParticipants = os
  .input(z.object({ id: z.string() }))
  .handler(({ input }) => {
    return getSessionParticipants(input.id);
  });
