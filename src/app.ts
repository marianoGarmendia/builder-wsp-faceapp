import {
  createBot,
  createProvider,
  createFlow,
  addKeyword,
  utils,
  MemoryDB,
  EVENTS,
} from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { chatAgent } from "./agent";
import { typing } from "./utils/presence";

const userQueues = new Map();
const userLocks = new Map(); // New lock mechanism

// const startFlow = addKeyword<Provider, MemoryDB>(EVENTS.WELCOME).addAnswer(
//   `Hola Dime en que puedo ayudarte`,
//   { capture: true },
//   async (ctx, { flowDynamic }) => {
//     const data = await chatAgent(ctx.body);
//     await flowDynamic([{ body: data[0] }]);
//   }
// );

/**
 * Function to process the user's message by sending it to the OpenAI API
 * and sending the response back to the user.
 */
const processUserMessage = async (ctx, { flowDynamic, state, provider }) => {
  await typing(ctx, provider);
  const response = await chatAgent(ctx.body, ctx);
  console.log("response desde app.ts: ", response);

  // Split the response into chunks and send them sequentially
  const chunks = response.split(/\n\n+/);
  for (const chunk of chunks) {
    const cleanedChunk = chunk.trim().replace(/【.*?】[ ] /g, "");
    await flowDynamic([{ body: cleanedChunk }]);
  }
};

/**
 * Function to handle the queue for each user.
 */
const handleQueue = async (userId) => {
  const queue = userQueues.get(userId);

  if (userLocks.get(userId)) {
    return; // If locked, skip processing
  }

  while (queue.length > 0) {
    userLocks.set(userId, true); // Lock the queue
    const { ctx, flowDynamic, state, provider } = queue.shift();
    try {
      await processUserMessage(ctx, { flowDynamic, state, provider });
    } catch (error) {
      console.error(`Error processing message for user ${userId}:`, error);
    } finally {
      userLocks.set(userId, false); // Release the lock
    }
  }

  userLocks.delete(userId); // Remove the lock once all messages are processed
  userQueues.delete(userId); // Remove the queue once all messages are processed
};

/**
 * Flujo de bienvenida que maneja las respuestas del asistente de IA
 * @type {import('@builderbot/bot').Flow<Provider, MemoryDB>}
 */

const welcomeFlow = addKeyword<Provider, MemoryDB>(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic, state, provider }) => {
    const userId = ctx.from; // Use the user's ID to create a unique queue for each user
    console.log(ctx);

    if (!userQueues.has(userId)) {
      userQueues.set(userId, []);
    }

    const queue = userQueues.get(userId);
    queue.push({ ctx, flowDynamic, state, provider });

    // If this is the only message in the queue, process it immediately
    if (!userLocks.get(userId) && queue.length === 1) {
      await handleQueue(userId);
    }
  }
);

const main = async () => {
  const provider = createProvider(Provider);

  const { handleCtx, httpServer } = await createBot({
    flow: createFlow([welcomeFlow]),
    database: new MemoryDB(),
    provider: provider,
  });

  provider.server.post(
    "/v1/messages",
    handleCtx(async (bot, req, res) => {
      console.log("req.body", req.body);

      const { number, message, urlMedia } = req.body;
      await bot?.sendMessage(number, message, { media: urlMedia ?? null });
      return res.end("sended");
    })
  );

  httpServer(5000);
};

main();
