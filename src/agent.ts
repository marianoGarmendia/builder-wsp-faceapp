import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { SystemMessage , HumanMessage, AIMessage } from "@langchain/core/messages";
// import { ChatPromptTemplate } from "@langchain/core/prompts";
// import { StringOutputParser } from "@langchain/core/output_parsers";
import "dotenv/config";


// TODO: Hacer generico el agente de confimracion y que el contexto solo sea el mensaje que le llega al usuario, que unicamente valide la confirmacion o el rechazo del mensaje del usuario.

// const model = new ChatOpenAI({
//   model: "gpt-4o-mini",
//   temperature: 0,
// });

// Create a prompt template with system and user messages
// const prompt = ChatPromptTemplate.fromMessages([
//   ["system", "You are a helpful assistant that translates {input_language} to {output_language}."],
//   ["human", "{input}"],
// ]);

// const outputParser = new StringOutputParser();
// const chain = prompt.pipe(model).pipe(outputParser);

// Invoke the chain
// await chain.invoke({
//   message_to_confirmation: "",
//   output_language: "German", 
//   input: "I love programming."
// });







  


  const confirmArgs = z.object({
    user_confirm: z.boolean().describe("El usuario acepto o rechazo la solicitud de confimración"),
    user_response: z.string().describe("La respuesta al usuario si es que corresponde, es decir, si es que se debe responder al usuario"),
    undefined_confirm: z.boolean().describe("El usuario no respondio si acepta o rechaza lo solicitado, hizo alguna pregunta al respecto y espera respuesta, en este caso debes asignar 'true' , en cambio si respondio confirmando o rechazando, debes asignar 'false'"),
  });

  const confirmTool = tool((_: any) => "no-op", {
    name: "confirm_request",
    description: "herramienta para confirmar o rechazar una accion determinada y para darle una respuesta al usuario si es que corresponde",
    schema: confirmArgs as any,
  }) as any
  
  const llmWithStrictTrue = new ChatOpenAI({
    model: "gpt-4o-mini",
  }).bindTools([confirmTool] as any, {
    strict: true,
    tool_choice: confirmTool.name,
  });

  const model = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 2,
  })
  
  // Although the question is not about the weather, it will call the tool with the correct arguments
  // because we passed `tool_choice` and `strict: true`.


const filterContext = async (context: string): Promise<string> => {
  try {
    const response = await model.invoke([
      new SystemMessage(`Tu unica tarea es transformar el contexto que te va a llegar del usuario.

        Este es solo un ejemplo de como puede llegarte el contexto, ten en cuenta que puede haber mas campos o menos campos, pero siempre sera un objeto en string con varias propiedades:

         {"fechaSolicitud":"2025-09-12","cliente":{"nombre":"simo","apellido":"lopecio","apellido2":"salinacio","email":"simonlopezs@gmail.com"},"instrucciones_documentos":"El ine es tu documento de identificación oficial. Puedes sacarle una foto, o enviar un pdf o una imagen escaneada. El comprobante de domicilio puede ser una foto o pdf de cualquier boleta de servicios donde figure tu dirección."}
  
         debes tranformarlo a un solo string en lenguaje natural, que tenga sentido, debes identificar datos que sean innecesarios o no relevantes para ser devuelto a un flujo el cual va a consumirlo y procesar el contexto para responder posibles preguntas del usuario.
         Debes retornar el string sin ningun otro texto adicional.
         debe llegar en español.
        
        `),
      new HumanMessage(context),
    ]);
    console.log("response filterContext: ---------->", response.content);
    return response.content as string;
    
  } catch (error) {
    console.error("Error al filtrar el contexto", error);
    return "";
  }
}

export const agent = async ({message_to_confirmation, message_user , step , iaContext}: {message_to_confirmation: string, message_user: string, step?: string, iaContext?: string}) => {
const processStep = step === "validate_customer" ? "Estas en un proceso confirmación" : step === "request_documentation" ? "Estas en el paso de solicitud de documentación" : "";


const contextFilter = await filterContext(iaContext.toString());

const context = contextFilter ? contextFilter : "No hay contexto adicional";

console.log("context: ---------->", context);
 
  const prompt = `
  Eres encargado del área de confirmaciones de solicitudes. en este caso el usuario debe confirmar, rechazar o hacer alguna pregunta al respecto.
  ${processStep}

  contexto adicional: ${context}

  El usuario va a recibir el siguiente mensaje del asistente:

  ${message_to_confirmation}

  A este mensaje el usuario va a responder aceptando, rechazando o haciendo alguna pregunta al respecto.
  en caso de que repsonda con una pregunta debes responderla de manera clara y concisa, sin inventar informacion. y sin otra información que no se encuentre dentro de este contexto en general, dentro de la conversacion con el usuario.

  Tu respuesta debe ser estructurada segun la herramienta confirm_request.
  `

  console.log("-------------------------------------------------->");
 console.log("prompt agent: ---------------->", prompt);
 console.log("-------------------------------------------------->");


  const strictTrueResult = await llmWithStrictTrue.invoke([
    new SystemMessage(prompt),
    new AIMessage(message_to_confirmation),
    new HumanMessage(message_user),
  ]);
  console.dir(strictTrueResult.tool_calls, { depth: null });

  return strictTrueResult.tool_calls;
}



  console.log("llamando al agente")
agent({message_to_confirmation: "👋 Hola, te saludamos de Perdm, representante autorizado de izzi. Queremos confirmar contigo que contrataste el paquete *INTERNET 1000 MEGAS / SKEELO / VIX PREMIUM / MAX BA / APPLE TV+ *. ¿Podrías confirmarnos que este es el paquete correcto? ✅", message_user: "Quien lo contrato? y cuando?" , iaContext: ''});

  // await structuredLlm.invoke([{
  //   role: "user",
  //   content: `I am 6'5" tall and love fruit.`
  // }]);


  