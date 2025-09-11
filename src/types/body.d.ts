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
      completed?: boolean;
      number?: string;
      id_document?: string;
      uploadStatus?: "pending" | "completed" | "error";
      messageAfterApprove?: string;
      messageAfterReject?: string;
      lastMessage?: string;
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
  completed?: boolean;
  uploadStatus?: "pending" | "completed" | "error";
  idDocument?: string;
  createdAt: number;
  messageAfterApprove?: string;
  messageAfterReject?: string;
  lastMessage?: string;
  message?: string;
  expiresAt: number;        // epoch ms
  task?: "request_documentation" | "validate_customer" | string;
  documents?: { id: string, types: string[], message: string }[];
};

export type DocumentRecord = {
 data: {
  response: {
    type: string,
    file: {
      idDocument: string,
      filename: string,
      mimetype: string | null,
      size: number,
      content_base64: string,
    },
  },
 },
 id_captacion: string,
 phone: string,
 timestamp: number,
};

