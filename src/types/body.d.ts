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

  export type Payload = {
    data?: {
      name?: string;
      number?: string;
      documents?: { name:  string, type: "pdf" | "image" }[];
      message?: string;
      task?: "request_documentation" | "validate_customer" | string;
      service?: string;
      endpoint?: string;
      id_captacion?: string;
      timestamp?: string;
      strategy?: {
        maxAttempts?: number;
        attemptDelay?: number;
        attemptTimeout?: number;
        attemptMaxDelay?: number;
        attemptMinDelay?: number;
      };
    };
  };

  // key-value con expiración
export type CaptacionRecord = {
  id_captacion: string;
  endpointConfirm?: string; // si te llega en el payload
  createdAt: number;
  expiresAt: number;        // epoch ms
  task?: "request_documentation" | "validate_customer" | string;
};

export const responses = {
  request_documentation: "Se ha realizado una solicitud de documentación, por favor confirma que fuiste tú.",
  validate_customer: "Se ha realizado una solicitud de validación de cliente, por favor confirma que fuiste tú.",
  default: "Se ha realizado una solicitud de servicio, por favor confirma que fuiste tú.",
}