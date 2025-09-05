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
import { CtxIncomingMessage } from "./types/body";

const userQueues = new Map();
const userLocks = new Map(); // New lock mechanism
const userCaptaciones = new Map(); // Mapeo de 'number' del usuario y el 'id_captacion'

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
const processUserMessage = async (ctx: CtxIncomingMessage, { flowDynamic, state, provider }) => {
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
const handleQueue = async (userId: string) => {
  const queue = userQueues.get(userId);

  if (userLocks.get(userId)) {
    return; // If locked, skip processing
  }

  while (queue.length > 0) {
    userLocks.set(userId, true); // Lock the queue
    const { ctx, flowDynamic, state, provider } = queue.shift() as { ctx: CtxIncomingMessage, flowDynamic: any, state: any, provider: any };
    try {
      // await processUserMessage(ctx, { flowDynamic, state, provider });

      // TODO:
      // Procesar el mensaje del usuario y enviar la confirmacion o rechazo a winwin
       // Aca deberia poder extraer el enpoint donde confimrar o rechazar en winwin la solicitud , lo que haya respondido el usuario.

      console.log("ctx", ctx);
      const {body, from} = ctx as CtxIncomingMessage;

      // Hacer el mapeo con el 'from' del usuario y el 'id_captacion'
      // const id_captacion = userCaptaciones.get(from);
     
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

     // TODO:
// Aca almacenar el 'id_captacion' con el 'number' del usuario. para compararlo cuando haga el envío de la repsuesta del usuario

      const { number, message, urlMedia } = req.body;
      await bot?.sendMessage(number, message, { media: urlMedia ?? null });
      return res.end("sended");
    })
  );

  httpServer(5000);
};

/*
La respuesta del usuario en 'ctx' llega asi:

{
  key: {
    remoteJid: '56971524620@s.whatsapp.net',
    fromMe: false,
    id: '3EB0EA4412408F58F635FE',
    participant: undefined
  },
  messageTimestamp: 1757088047,
  pushName: 'Simo',
  broadcast: false,
  message: Message {
    extendedTextMessage: ExtendedTextMessage {
      text: '1',
      contextInfo: [ContextInfo],
      inviteLinkGroupTypeV2: 0
    },
    messageContextInfo: MessageContextInfo {
      deviceListMetadata: [DeviceListMetadata],
      deviceListMetadataVersion: 2,
      messageSecret: [Uint8Array],
      limitSharingV2: [LimitSharing]
    }
  },
  body: '1',
  name: 'Simo',
  from: '56971524620',
  host: '5492214371684'
}


- Paso 2 

Envair esta confimración al sistema winwin al enpoint que llega en la solicitud:

{
data: {
    response: {
        confirm_service: boolean
},
    "id_captacion": "1234567890",
    "phone": string,
    "timestamp": nunber
  }
}




*/

main();
