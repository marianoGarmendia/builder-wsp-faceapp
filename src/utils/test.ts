import axios from "axios";

const url = "http://localhost:5000/v1/messages";
const token = "1234567890";

const sendMessage = async (message: string, number: string) => {
  const response = await fetch(
    "http://localhost:5000/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
         message,
        number,
        source: "whatsapp",
      }),
    }
  );
};

// sendMessage("Probando 123", "5492214371684");

/*


1 - Recibir desde nuestro sistema la notificaion de que alguien solicitó el servicio. 
{
data:{
    "name": "Juan Perez",
    "number": "5492214371684",
    "message": "Se ha realizado una solicitud de servicio a nombre Juan Perez, por favor confirma que fuiste tú."
    "service": "suscripción",
    "strategy": [estrategia de intentos] { "maxAttempts": 3,
                                            "attemptDelay": 1000,
                                            "attemptTimeout": 10000,
                                            "attemptMaxDelay": 10000,
                                            "attemptMinDelay": 1000,
                                            "attemptMaxDelay": 10000,
                                            }
   
    "endpoint": "http://faceapp.com/api/messages" // endpoint de la api de faceapp
    "id_contacto": "1234567890"
}
}


2 - Enviar mensaje de confirmación
```
enviar mensaje: Se ha realizado una solicitud de servicio a nombre [nombre] , por favor confirma que fuiste tú.
Hora de la solicitud: [hora]
Servicio solicitado: [servicio]
Nombre del solicitante: [nombre]


Acepto - Rechazo 

```

'Manejar cola de mensajes'


3 - Si acepta o rechaza enviar mensaje de confirmacion (token en header)

-------------> Enviar a nuestro sistema (endpoint api de faceapp)
{
data: {
    response: true or false,
    "id_contacto": "1234567890"
  }
}



**Respuesta programadas para el usuario**
Gracias por contactar con nosotros, en breve un asesor se pondrá en contacto contigo.
Gracias por confirmar, en breve un asesor se pondrá en contacto contigo.

- Si rechaza, 

*/


// MyHipoteca

/*
La busqueda de hipotecas 


*/


const testEndpoint = async ({url, token, payload}: {url: string, token: string, payload: any}) =>  {
  try {
    const response = await axios.post(
      url,
      payload, // body JSON
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      }
    );

    console.log("Respuesta:", response.data);
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
  }
}



const payload = {
  data: {
    name: "Juan Perez",
    number: "5492214371684",
    message:
    "Se ha realizado una solicitud de servicio a nombre Juan Perez, por favor confirma que fuiste tú.",
    service: "suscripción",
    strategy: {
      maxAttempts: 3,
      attemptDelay: 1000,
      attemptTimeout: 10000,
      attemptMaxDelay: 10000,
      attemptMinDelay: 1000
    },
    endpoint: "http://localhost:5000/v1/messages", // endpoint de la api de faceapp
    id_contacto: "707070"
  }
};
// testEndpoint({url:"http://localhost:3000/process", token: "1234567890" , payload:payload});