import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productA, productB } = req.body;
  if (!productA || !productB) {
    return res.status(400).json({ error: 'Both products are required' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is missing' });
  }

  const systemPrompt = `Eres Karol Garcia, la experta asesora de tecnología de Xiaomi Cartagena. Tu tarea es ayudar al cliente a decidir entre dos celulares de forma RÁPIDA, DIRECTA y ÉPICA.
Debes dar un veredicto de máximo 2-3 párrafos cortos.
1. Destaca la mayor ventaja de cada uno de manera muy amigable y persuasiva.
2. Termina con un consejo claro: "Si buscas [X], te recomiendo la Opción A. Si prefieres [Y], vete a la fija con la Opción B."
Tono: Emocionante, humano, carismático, con expresiones naturales colombianas.`;

  const userPrompt = `
Opción A: ${productA.name} - $${productA.price}
Descripción: ${productA.description}

Opción B: ${productB.name} - $${productB.price}
Descripción: ${productB.description}

Karol, compara estos dos equipos y dame tu recomendación final para que el cliente pueda decidir ya mismo.`;

  try {
    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });

    if (!openAiResponse.ok) {
      throw new Error('OpenAI API Error');
    }

    const data = await openAiResponse.json();
    const reply = data.choices[0].message.content;

    return res.status(200).json({ recommendation: reply });
  } catch (error: any) {
    console.error('Error in compare API:', error);
    return res.status(500).json({ error: error.message });
  }
}
