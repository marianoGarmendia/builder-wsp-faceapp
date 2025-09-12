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
import { downloadMediaMessage } from "baileys";
// import { chatAgent } from "./agent";
import { typing } from "./utils/presence";
import { CaptacionRecord, CtxIncomingMessage, Payload } from "./types/body";
import { setCaptacion, getCaptacion } from "./utils/kv-memory-ttl";
import { agent } from "./agent";
import axios from "axios";
import dotenv from "dotenv";
import { join } from "path";
import path from "path";
import fs from "fs";
import { mkdir } from "fs/promises";

dotenv.config();

// TODO: Gestionar la cantidad de mensajes en cada respuesta, maximo 3 mensajes por respuesta
// TODO: Cuando ya se haya enviado el ultimo mensaje, confirmando o no , no se debe enviar ningun mensaje mas
// TODO: 

const token = process.env.TOKEN;

const MEDIA_DIR = join(process.cwd(), "media");
const userQueues = new Map();
const userLocks = new Map(); // New lock mechanism
const userCaptaciones = new Map(); // Mapeo de 'number' del usuario y el 'id_captacion'

// Helper para extraer mimetype desde mensajes anidados (ephemeral/viewOnce)
const extractMimeTypeFromCtx = (ctx: any): string | undefined => {
  let m = ctx?.message;
  let depth = 0;
  while (m && depth < 5) {
    const mimeType =
      m.imageMessage?.mimetype ||
      m.audioMessage?.mimetype ||
      m.videoMessage?.mimetype ||
      m.documentMessage?.mimetype ||
      m.documentWithCaptionMessage?.message?.documentMessage?.mimetype;
    if (mimeType) return mimeType;
    m =
      m.ephemeralMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessage?.message ||
      m.deviceSentMessage?.message;
    depth++;
  }
  return undefined;
};

// Guardado con fallback cuando el provider no detecta mimetype
const sanitizeSegment = (s: string) => String(s ?? "").replace(/[^\w.\-]/g, "_");
const saveIncomingFile = async (
  ctx: any,
  provider: any,
  baseDir: string,
  rec?: CaptacionRecord
): Promise<string> => {
  const phoneSegment = sanitizeSegment((ctx as any)?.from || "unknown");
  const idSegment = sanitizeSegment((rec as any)?.id_captacion || "noid");
  const idDocumentSegment = sanitizeSegment((rec as any)?.idDocument || "noidocument");
  const targetDir = path.join(baseDir, phoneSegment, idSegment, idDocumentSegment);
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    // Intenta guardar con el provider dentro del directorio por usuario/id
    return await provider.saveFile(ctx, { path: targetDir });
  } catch (err: any) {
    if (!err?.message?.includes("MIME type not found")) throw err;
    console.warn("saveFile: MIME no detectado, usando fallback.");
    const buffer: Buffer = await downloadMediaMessage(ctx as any, "buffer", {});
    const mimeType = extractMimeTypeFromCtx(ctx);
    const extension = mimeType?.split("/")?.[1] || "bin";
    const m: any = (ctx as any)?.message || {};
    const suggestedName =
      m?.documentMessage?.fileName ||
      m?.documentMessage?.title ||
      (m?.imageMessage ? `image-${Date.now()}.${extension}` : `file-${Date.now()}.${extension}`);
    const safeName = sanitizeSegment(suggestedName);
    const destPath = path.join(targetDir, safeName);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer);
    return destPath;
  }
};

// Enviar archivo al endpoint externo como JSON con base64
const pathStartsWith = (child: string, parent: string) => {
  const childRes = path.resolve(child);
  const parentRes = path.resolve(parent);
  return childRes === parentRes || childRes.startsWith(parentRes + path.sep);
};

const findLatestFileInDir = (dirPath: string): string | undefined => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length === 0) return undefined;
    let latest: { name: string; mtimeMs: number } | undefined;
    for (const name of files) {
      const full = path.join(dirPath, name);
      const stat = fs.statSync(full);
      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = { name, mtimeMs: stat.mtimeMs };
      }
    }
    return latest ? path.join(dirPath, latest.name) : undefined;
  } catch {
    return undefined;
  }
};

const sendFileToEndpoint = async (
  filePath: string,
  ctx: CtxIncomingMessage,
  rec: CaptacionRecord,
  mimeType: string | undefined,
  kind: "media" | "document"
): Promise<boolean> => {
  try {
    const { endpointConfirm, id_captacion, idDocument } = rec;
    if (!endpointConfirm) {
      console.warn(
        "sendFileToEndpoint: endpointConfirm ausente en captación",
        rec
      );
      return false;
    }
    // Validar que el path pertenezca al usuario y captación esperados
    const expectedDir = path.join(
      MEDIA_DIR,
      sanitizeSegment((ctx as any)?.from || "unknown"),
      sanitizeSegment(id_captacion || "noid"),
      sanitizeSegment(idDocument || "noidocument")
    );
    if (!pathStartsWith(filePath, expectedDir)) {
      console.warn(
        "sendFileToEndpoint: filePath fuera de carpeta esperada, usando último archivo de la carpeta",
        { filePath, expectedDir }
      );
      const fallbackPath = findLatestFileInDir(expectedDir);
      if (fallbackPath) {
        filePath = fallbackPath;
      } else {
        console.error("sendFileToEndpoint: no se encontró archivo en", expectedDir);
        return false;
      }
    }
    const buffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    // TODO: Limitar el tamaño del archivo a 10MB

    const payload = {
      data: {
        response: {
          type: kind,
          file: {
            idDocument,
            filename,
            mimetype: mimeType || null,
            size: buffer.length,
            content_base64: buffer.toString("base64"),
          },
        },
        id_captacion,
        phone: ctx.from,
        timestamp: Date.now(),
      },
    };

   

    const response = await axios.post(endpointConfirm, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    console.error("sendFileToEndpoint error:", err);
    return false;
  }
};

const mediaFlowGpt = addKeyword<Provider, MemoryDB>(
  utils.setEvent("MEDIA_FLOW_GPT")
) // o tu keyword
  .addAction(async (ctx, { provider, flowDynamic }) => {
    // 1) Detectar tipo
    const msg = ctx as any; // Baileys WAMessage-like
    const m = msg.message || {};
    const isImage = !!m.imageMessage;
    const isDocument = !!m.documentMessage; // PDFs u otros docs

    // DESCOMENTAR PARA PRODUCCION
    // if (!isImage && !isDocument) {
    //   return flowDynamic("No recibí media. Probá con una imagen o PDF.");
    // }

    // 2) Tomar metadata básica
    const mimeType = isImage
      ? m.imageMessage.mimetype
      : m.documentMessage.mimetype; // p.ej. 'application/pdf'

    const suggestedName =
      (isDocument && (m.documentMessage.fileName || m.documentMessage.title)) ||
      (isImage ? "imagen.jpg" : "archivo.bin");

    // 3) Descargar a Buffer
    //    Pasamos el WAMessage completo (ctx) y pedimos 'buffer'
    const buffer: Buffer = await downloadMediaMessage(msg, "buffer", {});

    // 4) Guardar en disco (podés cambiar por S3, Supabase Storage, etc.)
    const ext = isImage
      ? mimeType?.split("/")[1] || "jpg"
      : suggestedName?.split(".").pop() || "bin";
    const safeName = suggestedName?.replace(/[^\w.\-]/g, "_") || `file.${ext}`;
    const filePath = path.join(process.cwd(), "uploads", safeName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);

    console.log(
      "✅ Recibido y guardado: *${safeName}* (${mimeType || 'desconocido'})"
    );

    // DESCOMENTAR PARA PRODUCCION
    // await flowDynamic([
    //   `✅ Recibido y guardado: *${safeName}* (${mimeType || "desconocido"})`,
    // ]);

   
    // 5) (Opcional) Reenviar inmediatamente (ver sección 3)
    // await flowDynamic([{ body: "Te reenvío el archivo:", media: filePath }]);
  });

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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shouldRetry = (err: any) => {
  const status = err?.response?.status;
  const code = err?.code;
  return !status || status >= 500 || status === 429 || code === "ECONNRESET" || code === "ETIMEDOUT";
};

const processUserMessageConfirm = async (
  ctx: CtxIncomingMessage,
  rec: CaptacionRecord,
  confirm_service: boolean,
  { flowDynamic, state, provider, user_response, user_confirm, undefined_confirm }
) => {
  await typing(ctx, provider);
  // const response = await chatAgent(ctx.body, ctx);
  console.log("processUserMessageConfirm: ");
  console.log("user_confirm", user_confirm);
  console.log("user_response", user_response);
  console.log("undefined_confirm", undefined_confirm);

  console.log("rec", rec);

  const { endpointConfirm } = rec;
  console.log("endpointConfirm", endpointConfirm);



  const payload = {
    data: {
      response: {
        type: "boolean",
        confirm_service: user_confirm,
      },
      id_captacion: rec.id_captacion,
      phone: ctx.from,
      timestamp: Date.now(),
    },
  };

  if (!endpointConfirm) {
    return console.error(
      "No se encontró el endpoint para registrar tu respuesta."
    );
  }
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++){
  try {
    const response = await axios.post(endpointConfirm, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });


    const { messageAfterApprove, messageAfterReject } = rec;
    const messageResponse = user_confirm ? messageAfterApprove : messageAfterReject;

    // TODO: acepte que lo llamen si rechazó la solicitud
    

    if (response.status === 200) {
      setCaptacion(ctx.from, { ...rec ,uploadStatus: "completed" });
      return await flowDynamic([{ body: messageResponse }]);
    } else {
      await flowDynamic([
        {
          body: "Error al registrar tu respuesta, nos pondremos en contacto contigo a la brevedad para resolverlo \n Gracias por tu tiempo",
        },
      ]);
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    const last = attempt === maxAttempts;
    if (!shouldRetry(err) || last) {
      return await flowDynamic([{ body: "Error al registrar tu respuesta, nos pondremos en contacto contigo a la brevedad para resolverlo \n Gracias por tu tiempo" }]);
    }
    await delay(500 * Math.pow(2, attempt - 1));
  }
  }
};

let intentos = 0;

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

      const { body, from } = ctx as CtxIncomingMessage;

      // 1) buscar la captación por teléfono
      const rec = getCaptacion(from);
      console.log("rec desde handleQueue", rec);
      if (!rec) {
        console.log("No se encontró la captación");
        return;
      }

      if(rec.uploadStatus === "completed") {
        console.log("La confirmacion fue completada");
        return await flowDynamic([{ body: "Ya completaste el proceso!  nos pondremos en contacto a la brevedad, muchas gracias." }]);
      
      }


      const { iaContext } = rec;
      const response = await agent({message_to_confirmation: rec.message, message_user: body, iaContext , step: rec.task as "validate_customer" | "request_documentation"});
      const { user_confirm, user_response , undefined_confirm  } = response[0].args;

      if(undefined_confirm) {
        state.update({ undefined_confirm: true , from: ctx.from });
        return await flowDynamic([{ body: user_response }]);
      }

      const isAccept = new Set(["1", "acepto", "si"]).has(
        normalizeConfirm(body)
      );
      // 2) enviar la respuesta al endpoint de winwin
      await processUserMessageConfirm(ctx, rec, isAccept, {
        user_response,
        user_confirm,
        undefined_confirm,
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

// const processResponseWithDocsAndMedia = async (
//   ctx: CtxIncomingMessage,
//   { flowDynamic, state, provider }
// ) => {
//   const userId = ctx.from; // Use the user's ID to create a unique queue for each user
//   console.log("processResponseWithDocsAndMedia ---------->");
// };

const confirmFlow = addKeyword<Provider, MemoryDB>(
  utils.setEvent("CONFIRM_FLOW")
).addAction(async (ctx, { flowDynamic, state, provider }) => {
  const userId = ctx.from; // Use the user's ID to create a unique queue for each user
  console.log("confirmFlow ---------->");
  console.log(ctx.body);
  console.log("-------------------------------------------------->");
  console.log("ctx", ctx);
  // Guard: validar captación antes de procesar
  const recConfirm = getCaptacion(userId);
  if (!recConfirm) {
    console.log(
      "confirmFlow: usuario sin captación activa. Se ignora el mensaje."
    );
    return;
  }
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

const mediaFlowCursor = addKeyword<Provider, MemoryDB>(EVENTS.MEDIA).addAction(
  { capture: false },
  async (ctx, { provider, state, flowDynamic }) => {
    const messageKeys = Object.keys((ctx as any)?.message || {});
    const mimeFromCtx = extractMimeTypeFromCtx(ctx as any);
    // Guard: validar captación antes de procesar media, pero loguear para debug
    const recMedia = getCaptacion((ctx as any)?.from || "");
    if (!recMedia) {
      console.log(
        "[MEDIA][IGNORADO] from:",
        (ctx as any)?.from,
        "keys:",
        messageKeys,
        "mime:",
        mimeFromCtx,
        "body:",
        (ctx as any)?.body
      );
      return;
    }

    if(recMedia.completed) {
      console.log("el proceso ya fue completado");
     
    }
    if(recMedia.uploadStatus === "completed") {
      console.log("Ya esta todo subido");
      return await flowDynamic([{ body: "El proceso ya fue completado, nos pondremos en contacto contigo a la brevedad, muchas gracias." }]);
    }

    console.log(
      "[MEDIA] keys:",
      messageKeys,
      "mime:",
      mimeFromCtx,
      "body:",
      (ctx as any)?.body
    );
    const savedPath = await saveIncomingFile(ctx, provider, MEDIA_DIR , recMedia);
    await state.update({ lastMediaPath: savedPath });
    // await flowDynamic([{ body: '✅ Archivo guardado. Te lo reenvío como confirmación:', media: savedPath }])
    console.log("✅ Archivo guardado, path: ", savedPath);
    // Si hay captación, enviar al endpoint de confirmación
    if (recMedia) {
      const ok = await sendFileToEndpoint(
        savedPath,
        ctx as any,
        recMedia,
        mimeFromCtx,
        "media"
      );

      const message = recMedia.lastMessage || "Tu archivo se ha subido correctamente. ";
      if (ok) {
        setCaptacion(ctx.from, { ...recMedia ,uploadStatus: recMedia.completed ? "completed" : "pending" });
        return await flowDynamic([{ body: message }]);
      } else {
        console.warn("[MEDIA] Falló envío al endpoint externo");
        throw new Error(`HTTP failed to send file to endpoint`);
      }
    }
  }
);

const documentFlow = addKeyword<Provider, MemoryDB>(EVENTS.DOCUMENT).addAction(
  { capture: false },
  async (ctx, { provider, state, flowDynamic }) => {
    const messageKeys = Object.keys((ctx as any)?.message || {});
    const mimeFromCtx = extractMimeTypeFromCtx(ctx as any);
    const m: any = (ctx as any)?.message || {};
    const docName = m?.documentMessage?.fileName || m?.documentMessage?.title;
    const docSize =
      m?.documentMessage?.fileLength?.toString?.() ||
      m?.documentMessage?.fileLength;
    // Guard: validar captación antes de procesar documentos, pero loguear para debug
    const recDoc = getCaptacion((ctx as any)?.from || "");
    if (!recDoc) {
      console.log(
        "[DOCUMENT][IGNORADO] from:",
        (ctx as any)?.from,
        "name:",
        docName,
        "size:",
        docSize,
        "mime:",
        mimeFromCtx,
        "keys:",
        messageKeys,
        "body:",
        (ctx as any)?.body
      );
      return;
    }
    if(recDoc.completed) {
      console.log("Este es el último documento para subir");
      
    }

    if(recDoc.uploadStatus === "completed") {
      console.log("Ya esta todo subido");
      return await flowDynamic([{ body: "El proceso ya fue completado, nos pondremos en contacto contigo a la brevedad, muchas gracias." }]);
    }

    console.log(
      "[DOCUMENT] keys:",
      messageKeys,
      "name:",
      docName,
      "size:",
      docSize,
      "mime:",
      mimeFromCtx,
      "body:",
      (ctx as any)?.body
    );
    const savedPath = await saveIncomingFile(ctx, provider, MEDIA_DIR, recDoc);
    await state.update({ lastDocumentPath: savedPath });
    console.log("✅ Documento guardado DOCUMENT, path: ", savedPath);
    // Si hay captación, enviar al endpoint de confirmación
    if (recDoc) {
      const ok = await sendFileToEndpoint(
        savedPath,
        ctx as any,
        recDoc,
        mimeFromCtx,
        "document"
      );
      if (ok) {
        const message = recDoc.lastMessage || "Tu archivo se ha subido correctamente. ";


          setCaptacion(ctx.from, { ...recDoc ,uploadStatus: recDoc.completed ? "completed" : "pending" });
        return await flowDynamic([{ body: message }]);
      } else {
        console.warn("[DOCUMENT] Falló envío al endpoint externo");
      }
    }
  }
);

/**
 * Flujo de bienvenida que maneja las respuestas
 * @type {import('@builderbot/bot').Flow<Provider, MemoryDB>}
 */

const welcomeFlow = addKeyword<Provider, MemoryDB>(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic, state, provider, gotoFlow }) => {
    const userId = ctx.from; // Use the user's ID to create a unique queue for each user
    console.log("welcomeFlow ---------->");
    console.log(ctx.body);
    console.log("-------------------------------------------------->");
    console.log("ctx", ctx);
    // Guard: validar captación antes de procesar el mensaje
    const recWelcome = getCaptacion(userId);
    if (!recWelcome) {
      console.log(
        "welcomeFlow: usuario sin captación activa. Mensaje ignorado."
      );

      // TODO: en produccion deberiamos tener un flowDynamic para enviar mensajes de que no estan registradas en el sistema


      return;
    }
    const valid = /^(1|2|acepto|rechazo|si|no)$/i;
    const msg = normalize(ctx.body);

    const isMediaOrDocument = ctx?.message?.mimetype || ctx?.message?.documentMessage?.mimetype;

    // if (valid.test(msg)) {
    //   return gotoFlow(confirmFlow);
    // } else {
    //   console.log("No aceptó ni rechazó la solicitud");
    // }

    const { task , uploadStatus } = recWelcome;

    if(uploadStatus === "completed") {
      console.log("Ya esta todo subido");
      return await flowDynamic([{ body: "Ya completaste el proceso!  nos pondremos en contacto a la brevedad, muchas gracias." }]);
    }

    if(task === "validate_customer") {
      
        return gotoFlow(confirmFlow);
     
    }else if(task === "request_documentation") {
      if(isMediaOrDocument) {
        return gotoFlow(mediaFlowCursor);
      } else {
        console.log("No es un archivo o imagen");
        return flowDynamic([{ body: "Por favor, envía un archivo o una imagen" }]);
      }
    }

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
  await mkdir(MEDIA_DIR, { recursive: true });

  const { handleCtx, httpServer } = await createBot({
    flow: createFlow([welcomeFlow, confirmFlow, mediaFlowCursor, documentFlow]),
    database: new MemoryDB(),
    provider: provider,
  });

  provider.server.post(
    "/v1/messages",
    handleCtx(async (bot, req, res) => {
      // Cuerpo del mensaje que le envaimos al usuario para iniciar la conversacion
      console.log("req.body", req.body);

      // TODO:
      // Aca almacenar el 'id_captacion' con el 'number' del usuario. para compararlo cuando haga el envío de la repsuesta del usuario

      const { number, message, payload } = req.body as {
        number: string;
        message: string;
        urlMedia?: string | null;
        payload: Payload;
      };



      const id_captacion: string | undefined =
        payload?.data?.id_captacion || "";
      // Endpoint para enviar la respuesta del usuario al mensaje de confirmación de la solicitud
      const endpointConfirm: string | undefined = payload?.data?.endpoint || "";
      const task: string | undefined = payload?.data?.task || "";
      const messageAfterApprove: string | undefined = payload?.data?.messageAfterApprove || "";
      const messageAfterReject: string | undefined = payload?.data?.messageAfterReject || "";
      const lastMessage: string | undefined = payload?.data?.lastMessage || "";
      const messageToClient: string | undefined = payload?.data?.message || "";
      const idDocument: string | undefined = payload?.data?.id_document || "";
      const uploadStatus: "pending" | "completed" | "error" | undefined = payload?.data?.uploadStatus ;
      const completed: boolean | undefined = payload?.data?.completed || false;
      const iaContext: string | undefined = payload?.data?.iaContext || "";

      if (!number || !id_captacion) {
        console.error("Faltan 'number' o 'id_captacion' en la solicitud");
        return res.status(400).json({ error: "number o id_captacion ausente" });
      }

      // Guarda el mapeo con TTL
      // Consultar dinamicamente en la tarea que está el usuario para saber si es de 'captacion' o 'servicio' 'pedir documentación'
      setCaptacion(number, { id_captacion, endpointConfirm , task, messageAfterApprove, messageAfterReject, lastMessage, message:messageToClient, idDocument , uploadStatus , completed, iaContext});

      // Aca almacenar el 'id_captacion' con el 'number' del usuario. para compararlo cuando haga el envío de la repsuesta del usuario
      // userCaptaciones.set(number, payload.data?.id_captacion);
      // console.log("sending message", number, message);

      try {
        await bot?.sendMessage(number, messageToClient, {});
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
