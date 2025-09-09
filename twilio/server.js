import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import dotenv from "dotenv";
dotenv.config();

import { setupSession, aiResponse, deleteSession } from "./engine.js";

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;

const WELCOME_GREETING =
  "Welcome to Who's Right! Please describe your question or debate, then tell me what each person said.";

const fastify = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);
fastify.all("/twiml", async (request, reply) => {
  reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}"
         ttsProvider="ElevenLabs"
         voice="RPEIZnKMqlQiZyZd1Dae"
        />
      </Connect>
    </Response>`
  );
});

fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (ws, req) => {
    ws.on("message", async (data) => {
      const message = JSON.parse(data);

      switch (message.type) {
        case "setup":
          const callSid = message.callSid;
          console.log("Setup for call:", callSid);
          ws.callSid = callSid;
          setupSession(callSid);
          break;
        case "prompt":
          console.log("Processing prompt:", message.voicePrompt);

          const response = await aiResponse(message.voicePrompt, ws.callSid);

          ws.send(
            JSON.stringify({
              type: "text",
              token: response,
              last: true,
            })
          );
          console.log("Sent response:", response);
          break;
        case "interrupt":
          console.log("Handling interruption.");
          break;
        default:
          console.warn("Unknown message type received:", message.type);
          break;
      }
    });

    ws.on("close", () => {
      console.log("WebSocket connection closed");
      deleteSession(ws.callSid);
    });
  });
});

try {
  fastify.listen({ port: PORT });
  console.log(
    `Server running at http://localhost:${PORT} and wss://${DOMAIN}/ws`
  );
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
