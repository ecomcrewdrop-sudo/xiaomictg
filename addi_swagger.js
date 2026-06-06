
window.onload = function() {
  // Build a system
  var url = window.location.search.match(/url=([^&]+)/);
  if (url && url.length > 1) {
    url = decodeURIComponent(url[1]);
  } else {
    url = window.location.origin;
  }
  var options = {
  "swaggerDoc": {
    "openapi": "3.0.3",
    "info": {
      "version": "1.0.1",
      "title": "ADDI API - Integración con un E-commerce - CO",
      "description": "Recursos HTTP que permiten ofrecer ADDI como medio de pago en una tienda en línea  (de ahora en adelante e-commerce). <br><br> En caso de fallas en la comunicación o fallos temporales en los recursos HTTP  de ADDI que retornen HTTP Status 5XX, se pueden realizar reintentos para obtener la respuesta original. Los recursos HTTP de nuestro API son idempotentes y garantizan que un crédito  va a ser originado una sola vez.<br><br>\n",
      "contact": {
        "email": "integraciones@addi.com"
      }
    },
    "tags": [
      {
        "name": "online application",
        "description": "Aplicación de crédito en línea"
      },
      {
        "name": "online application callback",
        "description": "Respuesta a una aplicación de crédito en línea"
      },
      {
        "name": "online application cancellation",
        "description": "Solicitud de cancelación total de crédito aprobado."
      }
    ],
    "paths": {
      "/v1/online-applications": {
        "post": {
          "security": [
            {
              "bearerAuth": []
            }
          ],
          "tags": [
            "online application"
          ],
          "summary": "Creación de una aplicación de crédito en línea desde un e-commerce para un cliente nuevo",
          "description": "Entiéndase \"aplicación de crédito en línea\" como la intención de un cliente nuevo de utilizar  ADDI como medio de pago en un e-commerce.  La plataforma notificará el estado de este tipo de aplicaciones a través de un \"callback\".  Entiéndase \"callback\" como una URL expuesta por el e-commerce en donde recibirá las  respuestas en formato JSON. Por favor tener en cuenta que este endpoint responde con un  código 301 con el header Location indicando la URL a la que se debe redirigir al usuario. Por lo tanto, esta URL debe ser capturada y se debe realizar la redirección manualmente.\n",
          "operationId": "createOnlineLoanApplication",
          "parameters": [
            {
              "in": "header",
              "name": "Authorization",
              "schema": {
                "type": "string"
              },
              "description": "Bearer: {validJWT}\n",
              "required": true
            }
          ],
          "requestBody": {
            "$ref": "#/components/requestBodies/OnlineLoanApplicationRequest"
          },
          "responses": {
            "301": {
              "description": "Redirección al sitio de ADDI.",
              "headers": {
                "Location": {
                  "schema": {
                    "type": "string"
                  },
                  "description": "Url de redirección al sitio de ADDI."
                }
              }
            },
            "400": {
              "description": "Cualquier otro tipos de error 4xx",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            },
            "409": {
              "description": "Conflicto. El cliente ya cuenta con crédito en ADDI, por tanto esta operación no esta soportada.",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            },
            "500": {
              "description": "Cualquier otro tipo de error 5xx",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            }
          }
        }
      },
      "/v2/online-applications": {
        "post": {
          "security": [
            {
              "bearerAuth": []
            }
          ],
          "tags": [
            "online application"
          ],
          "summary": "Creación de una aplicación de crédito en línea desde un e-commerce para un cliente nuevo con suppliers",
          "description": "Entiéndase \"aplicación de crédito en línea\" como la intención de un cliente nuevo de utilizar  ADDI como medio de pago en un e-commerce.  La plataforma notificará el estado de este tipo de aplicaciones a través de un \"callback\".  Entiéndase \"callback\" como una URL expuesta por el e-commerce en donde recibirá las  respuestas en formato JSON. Por favor tener en cuenta que este endpoint responde con un  código 301 con el header Location indicando la URL a la que se debe redirigir al usuario. Por lo tanto, esta URL debe ser capturada y se debe realizar la redirección manualmente.\n",
          "operationId": "createOnlineLoanApplicationWithSuppliers",
          "parameters": [
            {
              "in": "header",
              "name": "Authorization",
              "schema": {
                "type": "string"
              },
              "description": "Bearer: {validJWT}\n",
              "required": true
            }
          ],
          "requestBody": {
            "$ref": "#/components/requestBodies/OnlineLoanApplicationWithSuppliersRequest"
          },
          "responses": {
            "301": {
              "description": "Redirección al sitio de ADDI.",
              "headers": {
                "Location": {
                  "schema": {
                    "type": "string"
                  },
                  "description": "Url de redirección al sitio de ADDI."
                }
              }
            },
            "400": {
              "description": "Cualquier otro tipos de error 4xx",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            },
            "409": {
              "description": "Conflicto. El cliente ya cuenta con crédito en ADDI, por tanto esta operación no esta soportada.",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            },
            "500": {
              "description": "Cualquier otro tipo de error 5xx",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            }
          }
        }
      },
      "/v1/online-applications/cancellations": {
        "post": {
          "security": [
            {
              "bearerAuth": []
            }
          ],
          "tags": [
            "online application cancellation"
          ],
          "summary": "Solicitud de cancelación total de crédito aprobado.",
          "description": "Recurso HTTP que permitira recibir solicitudes de cancelacion de aplicaciones de credito que previamente han sido aprobadas, estas solicitudes seran procesadas y dependiendo del monto a cancelar enviado en la solicitud se realizara una cancelación total.\n",
          "operationId": "requestLoanCancellation",
          "parameters": [
            {
              "in": "header",
              "name": "Authorization",
              "schema": {
                "type": "string"
              },
              "description": "Bearer: {validJWT}\n",
              "required": true
            }
          ],
          "requestBody": {
            "$ref": "#/components/requestBodies/CreateCancellationRequest"
          },
          "responses": {
            "201": {
              "description": "Solicitud de cancelacion recibida correctamente."
            },
            "400": {
              "description": "Cualquier otro tipos de error 4xx",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            },
            "401": {
              "description": "Petición no autorizada",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            },
            "500": {
              "description": "Cualquier otro tipo de error 5xx",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                  }
                }
              }
            }
          }
        }
      },
      "/": {
        "post": {
          "security": [
            {
              "basicAuth": []
            }
          ],
          "tags": [
            "online application callback"
          ],
          "summary": "Respuesta a una aplicación de crédito en línea hacia el e-commerce.\n",
          "description": "Este recurso debe ser expuesto por el e-commerce y debe soportar la autenticación básica del protocolo HTTP.  Las credenciales para que la plataforma ADDI pueda consumirlo, deben ser proporcionadas por el e-commerce como parte del proceso de integración, a través de correos encriptados<br><br> Este recurso HTTP se encarga de recibir las respuestas a cualquier aplicación de  crédito en línea realizada en un e-commerce, se proveen 5 tipos de respuesta entre:<br><br> <b>APPROVED</b> = El valor solicitado por el cliente para cubrir la compra se aprobó en un 100%<br> <b>PENDING</b> = La aplicación de crédito en línea se encuentra en proceso de validación por parte de la plataforma ADDI<br> <b>REJECTED</b> = La aplicación de crédito en línea es rechazada. El cliente no ha sido aprobado para obtener un crédito con ADDI.<br> <b>ABANDONED</b> = La aplicación de crédito en línea superó el límite máximo de tiempo para su ejecución en la plataforma ADDI. <br> <b>DECLINED</b> = La aplicación de crédito en línea es declinada por el cliente. <br> <b>INTERNAL_ERROR</b> = Ha sucedido un error en la plataforma de ADDI. El cliente debe ser redirijido a seleccionar un método de pago diferente a ADDI en el e-commerce.<br><br> Cualquier respuesta diferente a APPROVED, llevará el campo approvedAmount=0. <br><br> La URL de callback será proporcionada por el e-commerce, siendo esta un campo obligatorio para el request body  (allyUrlRedirection.callbackUrl) del endpoint <b>/v1/online-applications</b> especificado en este mismo documento. <br>En caso de que se presente un error a la hora de enviar el resultado de una aplicación de crédito, ADDI tiene implementada una política de reintentos automática que garantiza la notificación del resultado incluso cuando se presentan intermitencias en el servidor del e-commerce. <br>La política de reintentos consiste en reintentar el envío del resultado cada 30 minutos durante 24 horas.\n",
          "parameters": [
            {
              "in": "header",
              "name": "Authorization",
              "description": "username:password codificados en Base64",
              "schema": {
                "type": "string"
              },
              "required": true
            }
          ],
          "requestBody": {
            "$ref": "#/components/requestBodies/OnlineLoanApplicationCallbackRequest"
          },
          "responses": {
            "200": {
              "description": "La respuesta fue recibida satisfactoriamente por parte del e-commerce.  El body de esta respuesta debe contener exactamente el mismo objecto  que fue enviado en la petición inicial (callback).\n",
              "content": {
                "application/json": {
                  "schema": {
                    "$ref": "#/components/schemas/OnlineLoanApplicationCallbackRequest"
                  }
                }
              }
            },
            "400": {
              "description": "Cualquier otro tipo de error 4xx"
            },
            "500": {
              "description": "Cualquier otro tipo de error 5xx"
            }
          }
        }
      }
    },
    "servers": [
      {
        "url": "https://api.addi-staging.com",
        "description": "Servidor de Staging (Provee datos de prueba)"
      },
      {
        "url": "https://api.addi.com",
        "description": "Servidor de Producción"
      }
    ],
    "components": {
      "securitySchemes": {
        "bearerAuth": {
          "type": "http",
          "scheme": "bearer",
          "bearerFormat": "JWT"
        },
        "basicAuth": {
          "type": "http",
          "scheme": "basic"
        }
      },
      "requestBodies": {
        "OnlineLoanApplicationRequest": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OnlineLoanApplicationRequest"
              }
            }
          },
          "description": "Parámetros necesarios para la originación del crédito",
          "required": true
        },
        "OnlineLoanApplicationWithSuppliersRequest": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OnlineLoanApplicationWithSuppliersRequest"
              }
            }
          },
          "description": "Parámetros necesarios para la originación del crédito",
          "required": true
        },
        "OnlineLoanApplicationCallbackRequest": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OnlineLoanApplicationCallbackRequest"
              }
            }
          },
          "description": "Parámetros necesarios para la originación del crédito",
          "required": true
        },
        "CreateCancellationRequest": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateCancellationRequest"
              }
            }
          },
          "description": "Parámetros necesarios para la solicitud de cancelacion del crédito",
          "required": true
        }
      },
      "schemas": {
        "OnlineLoanApplicationRequest": {
          "type": "object",
          "required": [
            "orderId",
            "totalAmount",
            "shippingAmount",
            "currency",
            "client",
            "allyUrlRedirection",
            "items"
          ],
          "properties": {
            "orderId": {
              "type": "string",
              "example": "8ujf387a5-ecc6-4324-8b78-ac27c952c737",
              "description": "Identificador único de la compra que asigna el e-commerce internamente."
            },
            "totalAmount": {
              "type": "string",
              "example": "255000.0",
              "description": "Monto del crédito a solicitar incluyendo impuestos (IVA), gastos de envio y cualquier\notro gasto relacionado. Centavos de peso separados por ."
            },
            "shippingAmount": {
              "type": "string",
              "example": "50000.0",
              "description": "Discriminación de los gastos de envio. Centavos de peso separados por ."
            },
            "totalTaxesAmount": {
              "type": "string",
              "example": "100000.0",
              "description": "Valor del IVA. Centavos de peso separados por ."
            },
            "currency": {
              "type": "string",
              "example": "COP",
              "description": "Formato ISO de la moneda en que se pide el crédito. Por el momento solo soportamos COP"
            },
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/Item"
              }
            },
            "client": {
              "$ref": "#/components/schemas/ClientInfo"
            },
            "shippingAddress": {
              "$ref": "#/components/schemas/ShippingAddress"
            },
            "billingAddress": {
              "$ref": "#/components/schemas/BillingAddress"
            },
            "pickUpAddress": {
              "$ref": "#/components/schemas/PickUpAddress"
            },
            "allyUrlRedirection": {
              "$ref": "#/components/schemas/AllyUrlRedirection"
            },
            "geoLocation": {
              "$ref": "#/components/schemas/GeoLocation"
            }
          }
        },
        "OnlineLoanApplicationWithSuppliersRequest": {
          "type": "object",
          "required": [
            "orderId",
            "totalAmount",
            "shippingAmount",
            "currency",
            "client",
            "allyUrlRedirection",
            "items",
            "suppliers"
          ],
          "properties": {
            "orderId": {
              "type": "string",
              "example": "8ujf387a5-ecc6-4324-8b78-ac27c952c737",
              "description": "Identificador único de la compra que asigna el e-commerce internamente."
            },
            "totalAmount": {
              "type": "string",
              "example": "255000.0",
              "description": "Monto del crédito a solicitar incluyendo impuestos (IVA), gastos de envio y cualquier\notro gasto relacionado. Centavos de peso separados por ."
            },
            "shippingAmount": {
              "type": "string",
              "example": "50000.0",
              "description": "Discriminación de los gastos de envio. Centavos de peso separados por ."
            },
            "totalTaxesAmount": {
              "type": "string",
              "example": "100000.0",
              "description": "Valor del IVA. Centavos de peso separados por ."
            },
            "currency": {
              "type": "string",
              "example": "COP",
              "description": "Formato ISO de la moneda en que se pide el crédito. Por el momento solo soportamos COP"
            },
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/Item"
              }
            },
            "suppliers": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/Supplier"
              }
            },
            "client": {
              "$ref": "#/components/schemas/ClientInfo"
            },
            "shippingAddress": {
              "$ref": "#/components/schemas/ShippingAddress"
            },
            "billingAddress": {
              "$ref": "#/components/schemas/BillingAddress"
            },
            "pickUpAddress": {
              "$ref": "#/components/schemas/PickUpAddress"
            },
            "allyUrlRedirection": {
              "$ref": "#/components/schemas/AllyUrlRedirection"
            },
            "geoLocation": {
              "$ref": "#/components/schemas/GeoLocation"
            }
          }
        },
        "Supplier": {
          "type": "object",
          "properties": {
            "supplierName": {
              "type": "string",
              "example": "Mundial"
            },
            "slugName": {
              "type": "string",
              "example": "mundial-pamii"
            },
            "shippingAmount": {
              "type": "number",
              "example": "1000"
            },
            "totalAmount": {
              "type": "number",
              "example": "25200"
            },
            "fee": {
              "type": "number",
              "example": "200"
            },
            "tax": {
              "type": "number",
              "example": "9950"
            },
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/Item"
              }
            }
          }
        },
        "Item": {
          "type": "object",
          "properties": {
            "sku": {
              "type": "string",
              "example": "PD-122354"
            },
            "name": {
              "type": "string",
              "example": "product name"
            },
            "quantity": {
              "type": "string",
              "example": "5"
            },
            "unitPrice": {
              "type": "string",
              "example": 9950
            },
            "tax": {
              "type": "string",
              "example": 9950
            },
            "pictureUrl": {
              "type": "string",
              "example": "https://picture.example.com/?img=test"
            },
            "category": {
              "type": "string",
              "example": "technology"
            },
            "brand": {
              "type": "string",
              "example": "adidas"
            }
          },
          "required": [
            "sku",
            "name",
            "quantity",
            "unitPrice"
          ]
        },
        "ClientInfo": {
          "type": "object",
          "properties": {
            "idType": {
              "type": "string",
              "example": "CC",
              "description": "Tipo de documento del cliente, sólo se recibe cédula de ciudadanía (CC)"
            },
            "idNumber": {
              "type": "string",
              "example": "354125896",
              "minimum": 1,
              "maximum": 15,
              "description": "Número de identificación del cliente"
            },
            "firstName": {
              "type": "string",
              "example": "marcela griselda",
              "description": "Primer nombre del cliente, o primer y segundo nombre en caso de que tenga"
            },
            "lastName": {
              "type": "string",
              "example": "Lopez Lopez",
              "description": "Apellidos del cliente"
            },
            "email": {
              "type": "string",
              "example": "addi-client@online.com",
              "description": "correo electrónico para registro con ADDI y envío de información relacionada al crédito"
            },
            "cellphone": {
              "type": "string",
              "example": "3211236584",
              "description": "Número de teléfono celular que este a nombre del cliente."
            },
            "cellphoneCountryCode": {
              "type": "string",
              "example": "+57",
              "description": "Código del país al que pertenece el número de teléfono"
            },
            "address": {
              "$ref": "#/components/schemas/Address"
            }
          },
          "required": [
            "idType",
            "idNumber",
            "firstName",
            "lastName",
            "email",
            "cellphone",
            "cellphoneCountryCode",
            "address"
          ]
        },
        "ShippingAddress": {
          "type": "object",
          "properties": {
            "lineOne": {
              "type": "string",
              "example": "cr 48 156 25 25",
              "description": "Dirección de envío de los productos asociados a la compra"
            },
            "city": {
              "type": "string",
              "example": "Bogotá D.C",
              "description": "Ciudad donde registra esa dirección de envio"
            },
            "country": {
              "type": "string",
              "example": "CO",
              "description": "Pais donde registra la ciudad y dirección de envio en formato ISO"
            }
          },
          "required": [
            "lineOne",
            "city",
            "country"
          ]
        },
        "BillingAddress": {
          "type": "object",
          "properties": {
            "lineOne": {
              "type": "string",
              "example": "cr 48 156 25 25",
              "description": "Dirección de facturación registrada por cliente"
            },
            "city": {
              "type": "string",
              "example": "Bogotá D.C",
              "description": "Ciudad donde registra esa dirección de facturación"
            },
            "country": {
              "type": "string",
              "example": "CO",
              "description": "Pais donde registra la ciudad y dirección de facturación en formato ISO"
            }
          },
          "required": [
            "lineOne",
            "city",
            "country"
          ]
        },
        "PickUpAddress": {
          "type": "object",
          "properties": {
            "lineOne": {
              "type": "string",
              "example": "cr 48 156 25 25",
              "description": "Dirección en la que el cliente va dirigirse a regocer la mercancia, en caso de que lo decida."
            },
            "city": {
              "type": "string",
              "example": "Bogotá D.C",
              "description": "Ciudad donde registra esa dirección de recogida"
            },
            "country": {
              "type": "string",
              "example": "CO",
              "description": "Pais donde registra la ciudad y dirección de recogida en formato ISO"
            }
          },
          "required": [
            "lineOne",
            "city",
            "country"
          ]
        },
        "AllyUrlRedirection": {
          "type": "object",
          "properties": {
            "logoUrl": {
              "type": "string",
              "example": "https://picture.example.com/?img=test",
              "description": "URL a una imagen descriptiva del e-commerce"
            },
            "callbackUrl": {
              "type": "string",
              "example": "https://ally.callback.url/callback/example",
              "description": "URL a donde se van a notificar las respuestas de las aplicaciones de crédito en línea"
            },
            "redirectionUrl": {
              "type": "string",
              "example": "https://redirection.example.com/",
              "description": "URL a donde se debe redireccionar al cliente"
            }
          },
          "required": [
            "callbackUrl",
            "redirectionUrl"
          ]
        },
        "GeoLocation": {
          "type": "object",
          "description": "Ubicación geográfica desde donde el cliente efectúa la aplicación de crédito en linea",
          "properties": {
            "latitude": {
              "type": "string",
              "example": "4.624335",
              "description": "latitud"
            },
            "longitude": {
              "type": "string",
              "example": "-74.063644",
              "description": "longitud"
            }
          }
        },
        "Address": {
          "type": "object",
          "properties": {
            "lineOne": {
              "type": "string",
              "example": "cr 48 156 25 25",
              "description": "Dirección de residencia del cliente"
            },
            "city": {
              "type": "string",
              "example": "Bogotá D.C",
              "description": "Ciudad donde registra esa dirección"
            },
            "country": {
              "type": "string",
              "example": "CO",
              "description": "Pais donde registra la ciudad y dirección de residencia en formato ISO"
            }
          },
          "required": [
            "lineOne",
            "city",
            "country"
          ]
        },
        "CallbackInformationResponse": {
          "type": "object",
          "properties": {
            "orderId": {
              "type": "string",
              "example": "8ujf387a5-ecc6-4324-8b78-ac27c952c737",
              "description": "Id de la orden"
            },
            "applicationId": {
              "type": "string",
              "example": "6e43fa8e-758e-42ba-9c09-5aada582dd32",
              "description": "Id de la aplicacion"
            },
            "longLoanId": {
              "type": "string",
              "example": "7as02bw8-f51d-4821-a48d-acb6df21afb1"
            },
            "shortLoanId": {
              "type": "string",
              "example": "21afb1"
            },
            "approvedAmount": {
              "type": "string",
              "example": "1000000",
              "description": "Monto aprobado"
            },
            "currency": {
              "type": "string",
              "example": "CO",
              "description": "Moneda"
            },
            "status": {
              "type": "string",
              "description": "Respuesta por parte de ADDI a la aplicación de crédito en línea, cualquier respuesta diferente a APPROVED llevará el campo approvedAmount = 0",
              "enum": [
                "APPROVED",
                "PENDING",
                "REJECTED",
                "ABANDONED",
                "DECLINED",
                "INTERNAL_ERROR"
              ]
            },
            "callbackStatus": {
              "type": "string",
              "description": "Estado del callback",
              "enum": [
                "SENT",
                "RECOVERABLE_ERROR",
                "UNRECOVERABLE_ERROR",
                "NOT_SENT",
                "NOT_AVAILABLE"
              ]
            },
            "statusTimestamp": {
              "type": "string",
              "example": "1632159325",
              "description": "Ultima vez que el callback cambio"
            }
          }
        },
        "OnlineLoanApplicationCallbackRequest": {
          "type": "object",
          "properties": {
            "orderId": {
              "type": "string",
              "example": "8ujf387a5-ecc6-4324-8b78-ac27c952c737",
              "description": "Identificador único de la compra que asigna el e-commerce internamente."
            },
            "applicationId": {
              "type": "string",
              "example": "o957b4611-6ef7-4f1c-b9be-02207bd9fd80",
              "description": "Identificador único de la respuesta a la aplicación de crédito en línea por parte de ADDI"
            },
            "approvedAmount": {
              "type": "string",
              "example": "150000.0",
              "description": "Monto aprobado del crédito, debe coincidir con el campo totalAmount del request. Centavos de peso separados por ."
            },
            "currency": {
              "type": "string",
              "example": "COP",
              "description": "Formato ISO de la moneda en que se pide el crédito. Por el momento solo soportamos COP"
            },
            "status": {
              "$ref": "#/components/schemas/Status"
            },
            "statusTimestamp": {
              "type": "string",
              "example": "1568398147",
              "description": "Unixtime en el que se genera la respuesta por parte de ADDI en zona horaria UTC"
            }
          },
          "required": [
            "orderId",
            "applicationId",
            "approvedAmount",
            "currency",
            "status",
            "statusTimestamp"
          ]
        },
        "CreateCancellationRequest": {
          "type": "object",
          "properties": {
            "orderId": {
              "type": "string",
              "example": "8ujf387a5-ecc6-4324-8b78-ac27c952c737",
              "description": "Identificador único de la compra que asigna el e-commerce internamente."
            },
            "amount": {
              "type": "string",
              "example": "150000.0",
              "description": "Monto a cancelar del crédito, Centavos de peso separados por ."
            }
          },
          "required": [
            "orderId",
            "amount"
          ]
        },
        "Status": {
          "type": "string",
          "description": "Respuesta por parte de ADDI a la aplicación de crédito en línea, cualquier respuesta diferente a APPROVED llevará el campo approvedAmount = 0",
          "enum": [
            "APPROVED",
            "PENDING",
            "REJECTED",
            "ABANDONED",
            "DECLINED",
            "INTERNAL_ERROR"
          ]
        },
        "ApiErrorResponse": {
          "type": "object",
          "properties": {
            "code": {
              "type": "string",
              "example": "001-001"
            },
            "message": {
              "type": "string",
              "example": "Mensaje que describe el error"
            }
          }
        }
      }
    }
  },
  "customOptions": {},
  "swaggerUrl": {}
};
  url = options.swaggerUrl || url
  var urls = options.swaggerUrls
  var customOptions = options.customOptions
  var spec1 = options.swaggerDoc
  var swaggerOptions = {
    spec: spec1,
    url: url,
    urls: urls,
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout"
  }
  for (var attrname in customOptions) {
    swaggerOptions[attrname] = customOptions[attrname];
  }
  var ui = SwaggerUIBundle(swaggerOptions)

  if (customOptions.oauth) {
    ui.initOAuth(customOptions.oauth)
  }

  if (customOptions.authAction) {
    ui.authActions.authorize(customOptions.authAction)
  }

  window.ui = ui
}
