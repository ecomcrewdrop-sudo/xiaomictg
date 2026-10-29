/**
 * Sondea si el WhatsApp de CREDILOCK está conectado.
 *
 * POR QUÉ: la tarjeta con el QR vive dentro de la pestaña de CrediLock, pero el
 * dueño puede pasarse semanas sin abrirla. Como un canal de cobranza caído no da
 * ninguna señal por sí solo (ya pasó: dos meses sin recordatorios y nadie se
 * enteró), este hook alimenta un aviso en la propia pestaña para que se vea desde
 * cualquier parte del panel.
 *
 * Cada 60 s es de sobra: esto detecta una caída, no pinta el QR en vivo (de eso se
 * encarga CredilockWhatsAppCard por Socket.io).
 */
import { useState, useEffect } from 'react';
import { API_BASE_URL } from './api-base';

export function useCredilockConectado(): boolean | null {
  // null = todavía no se sabe. Importa distinguirlo de false para no enseñar una
  // alarma roja durante el primer instante de carga.
  const [conectado, setConectado] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;

    const consultar = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/credilock/status`);
        const data = await res.json();
        if (vivo) setConectado(data.status === 'connected');
      } catch {
        // Un fallo de red no significa que CREDILOCK esté caído; dejamos el último
        // valor conocido para no dar una falsa alarma.
      }
    };

    consultar();
    const id = setInterval(consultar, 60000);
    return () => { vivo = false; clearInterval(id); };
  }, []);

  return conectado;
}
