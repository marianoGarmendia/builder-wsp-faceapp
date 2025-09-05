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
import { CaptacionRecord, CtxIncomingMessage, Payload } from "./types/body";
import { setCaptacion, getCaptacion } from "./utils/kv-memory-ttl";
import axios from "axios";

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
// const processUserMessage = async (ctx: CtxIncomingMessage, { flowDynamic, state, provider }) => {
//   await typing(ctx, provider);
//   const response = await chatAgent(ctx.body, ctx);
//   console.log("response desde app.ts: ", response);

//   // Split the response into chunks and send them sequentially
//   const chunks = response.split(/\n\n+/);
//   for (const chunk of chunks) {
//     const cleanedChunk = chunk.trim().replace(/【.*?】[ ] /g, "");
//     await flowDynamic([{ body: cleanedChunk }]);
//   }
// };

const processUserMessageConfirm = async (
  ctx: CtxIncomingMessage,
  rec: CaptacionRecord,
  confirm_service: boolean,
  { flowDynamic, state, provider }
) => {
  await typing(ctx, provider);
  // const response = await chatAgent(ctx.body, ctx);
  console.log("processUserMessageConfirm: ");

  console.log("rec", rec);

  const { endpointConfirm } = rec;
  console.log("endpointConfirm", endpointConfirm);

  const payload = {
    data: {
      response: {
        confirm_service: confirm_service,
      },
      id_captacion: rec.id_captacion,
      phone: ctx.from,
      timestamp: Date.now(),
    },
  };

  const response = await axios.post(endpointConfirm, payload);

  console.log("response", response);

  // Split the response into chunks and send them sequentially
  // const chunks = response.split(/\n\n+/);
 
    await flowDynamic([{ body: "Tu respuesta ha sido registrada" }]);

};

const normalizeConfirm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, ""); // "Sí" -> "si"

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
    const { ctx, flowDynamic, state, provider } = queue.shift() as {
      ctx: CtxIncomingMessage;
      flowDynamic: any;
      state: any;
      provider: any;
    };
    try {
      // TODO:
      // Procesar el mensaje del usuario y enviar la confirmacion o rechazo a winwin
      // Aca deberia poder extraer el enpoint donde confimrar o rechazar en winwin la solicitud , lo que haya respondido el usuario.

      console.log("ctx", ctx);
      const { body, from } = ctx as CtxIncomingMessage;

      // 1) buscar la captación por teléfono
      const rec = getCaptacion(from);
      console.log("rec", rec);
      if (!rec) {
        console.log("No se encontró la captación");
        return;
      }
      const isAccept = new Set(["1", "acepto", "si"]).has(normalize(ctx.body));
      // 2) enviar la respuesta al endpoint de winwin
      await processUserMessageConfirm(ctx, rec, isAccept, {
        flowDynamic,
        state,
        provider,
      });
    } catch (error) {
      console.error(`Error processing message for user ${userId}:`, error);
    } finally {
      userLocks.set(userId, false); // Release the lock
    }
  }

  userLocks.delete(userId); // Remove the lock once all messages are processed
  userQueues.delete(userId); // Remove the queue once all messages are processed
};

// util: normaliza (trim, lowercase, sin acentos)
const normalize = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, ""); // soporta "sí" -> "si"

/**
 * Flujo de CONFIRMACION
 * @type {import('@builderbot/bot').Flow<Provider, MemoryDB>}
 */

const confirmFlow = addKeyword<Provider, MemoryDB>([
  "1",
  "2",
  "acepto",
  "rechazo",
  "Acepto",
  "Rechazo",
  "si",
  "no",
  "Si",
  "No",
]).addAction(async (ctx, { flowDynamic, state, provider }) => {
  const userId = ctx.from; // Use the user's ID to create a unique queue for each user
  console.log("confirmFlow ---------->");
  console.log(ctx.body);

  if (!userQueues.has(userId)) {
    userQueues.set(userId, []);
  }

  const queue = userQueues.get(userId);
  queue.push({ ctx, flowDynamic, state, provider });

  // If this is the only message in the queue, process it immediately
  if (!userLocks.get(userId) && queue.length === 1) {
    await handleQueue(userId);
  }
});
/**
 * Flujo de bienvenida que maneja las respuestas
 * @type {import('@builderbot/bot').Flow<Provider, MemoryDB>}
 */

const welcomeFlow = addKeyword<Provider, MemoryDB>(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic, state, provider }) => {
    const userId = ctx.from; // Use the user's ID to create a unique queue for each user
    console.log("welcomeFlow ---------->");
    console.log(ctx.body);

    const valid = /^(1|2|acepto|rechazo|si|no)$/i;
    const msg = normalize(ctx.body);
// Descomentar para produccion
    // if (!valid.test(msg)) {
    //   return flowDynamic([
    //     {
    //       body: "Por favor, responda con '1' o '2' para aceptar o rechazar la solicitud.",
    //     },
    //   ]);
    // }
  }
);

// Funcion original

// const welcomeFlow = addKeyword<Provider, MemoryDB>(EVENTS.WELCOME).addAction(
//   async (ctx, { flowDynamic, state, provider }) => {
//     const userId = ctx.from; // Use the user's ID to create a unique queue for each user
//     console.log("welcomeFlow ---------->");
//     console.log(ctx.body);

// }

//     if (!userQueues.has(userId)) {
//       userQueues.set(userId, []);
//     }

//     const queue = userQueues.get(userId);
//     queue.push({ ctx, flowDynamic, state, provider });

//     // If this is the only message in the queue, process it immediately
//     if (!userLocks.get(userId) && queue.length === 1) {
//       await handleQueue(userId);
//     }
//   }
// );

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

      const { number, message , payload} = req.body as {
        number: string;
        message: string;
        urlMedia?: string | null;
        payload: Payload;
      };


      const id_captacion: string | undefined =
        payload?.data?.id_captacion || "";
      // Endpoint para enviar la respuesta del usuario al mensaje de confirmación de la solicitud
      const endpointConfirm: string | undefined = payload?.data?.endpoint || "";

      if (!number || !id_captacion) {
        console.error("Faltan 'number' o 'id_captacion' en la solicitud");
        return res.status(400).json({ error: "number o id_captacion ausente" });
      }

      // Guarda el mapeo con TTL
      setCaptacion(number, { id_captacion, endpointConfirm });

      // Aca almacenar el 'id_captacion' con el 'number' del usuario. para compararlo cuando haga el envío de la repsuesta del usuario
      // userCaptaciones.set(number, payload.data?.id_captacion);
      // console.log("sending message", number, message);

      try {
        await bot?.sendMessage(number, message, {});
        return res.end("sended");
      } catch (error) {
        console.error("Error sending message", error);
        console.log("error", error);
        return res.status(500).json({ error: "Error sending message" });
      }
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
