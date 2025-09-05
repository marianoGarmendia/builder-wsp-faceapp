export interface CtxIncomingMessage {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
      participant?: string; // puede venir undefined
    };
    messageTimestamp: number;
    pushName: string;
    broadcast: boolean;
    message: {
      conversation: string;
      messageContextInfo: {
        deviceListMetadata: unknown; // si sabés la forma, podés definirla mejor
        deviceListMetadataVersion: number;
        messageSecret: Uint8Array;
      };
    };
    body: string;
    name: string;
    from: string; // número del remitente
    host: string; // número "host"
  }