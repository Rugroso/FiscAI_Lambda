/**
 * HTTP Bridge para conectar AWS Lambda con el servidor MCP de FiscAI
 * Este módulo extiende la funcionalidad Lambda para incluir llamadas al servidor MCP
 */

const https = require('https');
const http = require('http');

// URL del servidor MCP desplegado
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://fiscmcp.fastmcp.app';

/**
 * Realiza una petición HTTP/HTTPS
 */
function makeHttpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'FiscAI-Lambda-Bridge',
        ...options.headers
      }
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Si el Content-Type es text/event-stream, parsear como SSE
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('text/event-stream')) {
            // Parsear formato SSE: "event: message\ndata: {json}\n\n"
            const lines = data.trim().split('\n');
            let jsonData = '';
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                jsonData = line.substring(6); // Remove "data: " prefix
                break;
              }
            }
            
            if (jsonData) {
              const parsed = JSON.parse(jsonData);
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: parsed
              });
              return;
            }
          }
          
          // Parsear como JSON normal
          const parsed = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

/**
 * Llama una herramienta del servidor MCP
 */
async function callMcpTool(toolName, toolArgs) {
  try {
    console.log(`[MCP] Llamando herramienta: ${toolName}`);
    console.log(`[MCP] Arguments:`, JSON.stringify(toolArgs));
    
    // FastMCP usa el protocolo MCP nativo vía POST /mcp/v1/tools/call
    // o simplemente POST con el formato JSON-RPC
    const mcpRequest = {
      jsonrpc: '2.0',
      id: `call-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs
      }
    };
    
    // Intentar con endpoint /mcp que requiere Accept: application/json, text/event-stream
    const response = await makeHttpRequest(`${MCP_SERVER_URL}/mcp`, {
      method: 'POST',
      body: mcpRequest,
      headers: {
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[MCP] Response status:`, response.statusCode);
    console.log(`[MCP] Response body:`, JSON.stringify(response.body));
    
    if (response.statusCode === 200) {
      // Si la respuesta tiene result, extraerlo
      if (response.body.result) {
        return response.body.result;
      }
      // Si es directamente el resultado
      return response.body;
    }
    
    // Si el error es por SSE, intentar sin SSE
    if (response.body.error && response.body.error.code === -32600) {
      console.log(`[MCP] Intentando con método alternativo...`);
      return await callMcpAlternative(toolName, toolArgs);
    }
    
    throw new Error(`Error MCP: ${JSON.stringify(response.body)}`);
    
  } catch (error) {
    console.error(`[MCP] Error llamando herramienta ${toolName}:`, error);
    throw new Error(`Error conectando con MCP: ${error.message}`);
  }
}

/**
 * Método alternativo: llamar directamente sin protocolo JSON-RPC
 */
async function callMcpAlternative(toolName, toolArgs) {
  console.log(`[MCP] Usando método alternativo para ${toolName}`);
  
  // Intentar endpoint directo REST-like
  const restUrl = `${MCP_SERVER_URL}/tools/${toolName}/call`;
  
  const response = await makeHttpRequest(restUrl, {
    method: 'POST',
    body: toolArgs,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  
  if (response.statusCode === 200) {
    return response.body;
  }
  
  throw new Error(`Error en método alternativo: ${JSON.stringify(response.body)}`);
}

/**
 * Método alternativo para prompts usando REST
 */
async function callMcpPrompt(promptName, promptArgs) {
  const mcpRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'prompts/get',
    params: {
      name: promptName,
      arguments: promptArgs
    }
  };
  
  console.log(`[MCP] Llamando prompt: ${promptName}`);
  
  try {
    // Usar endpoint /mcp que requiere Accept: application/json, text/event-stream
    const response = await makeHttpRequest(`${MCP_SERVER_URL}/mcp`, {
      method: 'POST',
      body: mcpRequest,
      headers: {
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.statusCode === 200 && response.body.result) {
      return response.body.result;
    }
    
    // Si SSE no funciona, intentar método alternativo
    console.log(`[MCP] SSE no disponible, usando método alternativo para prompt`);
    return await callMcpAlternativePrompt(promptName, promptArgs);
    
  } catch (error) {
    console.error(`[MCP] Error con SSE, intentando alternativa:`, error);
    return await callMcpAlternativePrompt(promptName, promptArgs);
  }
}

/**
 * Método alternativo para prompts usando REST
 */
async function callMcpAlternativePrompt(promptName, promptArgs) {
  const restUrl = `${MCP_SERVER_URL}/prompts/${promptName}`;
  
  const response = await makeHttpRequest(restUrl, {
    method: 'POST',
    body: promptArgs
  });
  
  if (response.statusCode === 200) {
    return response.body;
  }
  
  throw new Error(`Error en método alternativo (prompt): ${JSON.stringify(response.body)}`);
}

// ========== HANDLERS MCP ==========

/**
 * Handler para get_fiscal_advice vía MCP
 */
async function handleMcpFiscalAdvice(params) {
  const {
    actividad,
    ingresos_anuales,
    estado,
    regimen_actual,
    tiene_rfc,
    contexto_adicional
  } = params;

  if (!actividad) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "actividad"',
        required: ['actividad'],
        optional: ['ingresos_anuales', 'estado', 'regimen_actual', 'tiene_rfc', 'contexto_adicional']
      }
    };
  }

  try {
    // FastMCP espera los parámetros envueltos en un objeto 'request'
    const result = await callMcpTool('get_fiscal_advice', {
      request: {
        actividad,
        ingresos_anuales,
        estado,
        regimen_actual,
        tiene_rfc,
        contexto_adicional
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para chat_with_fiscal_assistant vía MCP
 */
async function handleMcpChat(params) {
  const { message, user_id, session_id } = params;

  if (!message) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "message"',
        required: ['message'],
        optional: ['user_id', 'session_id']
      }
    };
  }

  try {
    // FastMCP espera los parámetros envueltos en un objeto 'request'
    const result = await callMcpTool('chat_with_fiscal_assistant', {
      request: {
        message,
        user_id: user_id || 'lambda-user',
        session_id
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para analyze_fiscal_risk vía MCP
 */
async function handleMcpRiskAnalysis(params) {
  const {
    has_rfc,
    has_efirma,
    emite_cfdi,
    declara_mensual,
    ingresos_anuales,
    actividad,
    regimen_fiscal
  } = params;

  if (has_rfc === undefined) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "has_rfc"',
        required: ['has_rfc'],
        optional: ['has_efirma', 'emite_cfdi', 'declara_mensual', 'ingresos_anuales', 'actividad', 'regimen_fiscal']
      }
    };
  }

  try {
    // FastMCP espera los parámetros envueltos en un objeto 'request'
    const result = await callMcpTool('analyze_fiscal_risk', {
      request: {
        has_rfc,
        has_efirma,
        emite_cfdi,
        declara_mensual,
        ingresos_anuales,
        actividad,
        regimen_fiscal
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para search_fiscal_documents vía MCP
 */
async function handleMcpSearch(params) {
  const { query, limit } = params;

  if (!query) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "query"',
        required: ['query'],
        optional: ['limit']
      }
    };
  }

  try {
    // FastMCP espera los parámetros envueltos en un objeto 'request'
    const result = await callMcpTool('search_fiscal_documents', {
      request: {
        query,
        limit: limit || 5
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para search_places vía MCP (Google Places / deep links)
 * Espera params: { query, lat, lng, limit }
 */
async function handleMcpSearchPlaces(params) {
  const { query, lat, lng, limit } = params;

  if (!query) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "query"',
        required: ['query'],
        optional: ['lat', 'lng', 'limit']
      }
    };
  }

  try {
    // Llamar la herramienta MCP 'search_places' con la estructura esperada
    const result = await callMcpTool('search_places', {
      request: {
        query,
        lat: lat !== undefined ? Number(lat) : undefined,
        lng: lng !== undefined ? Number(lng) : undefined,
        limit: limit || 5
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para get_user_fiscal_context vía MCP
 */
async function handleMcpUserContext(params) {
  const { user_id } = params;

  if (!user_id) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "user_id"',
        required: ['user_id']
      }
    };
  }

  try {
    // FastMCP espera los parámetros envueltos en un objeto 'request'
    const result = await callMcpTool('get_user_fiscal_context', {
      request: {
        user_id
      }
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para fiscal_consultation prompt vía MCP
 */
async function handleMcpFiscalConsultation(params) {
  const { business_type, annual_income, state } = params;

  if (!business_type) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "business_type"',
        required: ['business_type'],
        optional: ['annual_income', 'state']
      }
    };
  }

  try {
    const result = await callMcpPrompt('fiscal_consultation', {
      business_type,
      annual_income,
      state
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Handler para risk_assessment prompt vía MCP
 */
async function handleMcpRiskAssessment(params) {
  const { current_status } = params;

  if (!current_status) {
    return {
      statusCode: 400,
      body: {
        error: 'Falta el parámetro "current_status"',
        required: ['current_status']
      }
    };
  }

  try {
    const result = await callMcpPrompt('risk_assessment', {
      current_status
    });

    return {
      statusCode: 200,
      body: {
        success: true,
        data: result,
        source: 'mcp_server',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Calcula riesgo simple basado en cumplimiento fiscal
 * Similar al código Python simple_risk()
 */
function calculateSimpleRisk(profile) {
  let penalties = 0;
  let details = [];
  
  if (!profile.has_rfc) {
    penalties += 1;
    details.push('RFC no registrado');
  }
  if (!profile.has_efirma) {
    penalties += 1;
    details.push('e.firma no vigente');
  }
  if (!profile.emite_cfdi) {
    penalties += 1;
    details.push('No emite CFDI');
  }
  if (!profile.declara_mensual) {
    penalties += 1;
    details.push('No presenta declaraciones mensuales');
  }
  
  let level = 'Verde';
  let message = 'Cumplimiento fiscal óptimo';
  
  if (penalties === 1) {
    level = 'Amarillo';
    message = 'Cumplimiento parcial, requiere atención';
  }
  if (penalties >= 2) {
    level = 'Rojo';
    message = 'Alto riesgo fiscal, acción inmediata requerida';
  }
  
  return {
    score: Math.max(0, 100 - (penalties * 25)),
    level,
    message,
    details: {
      has_rfc: profile.has_rfc || false,
      has_efirma: profile.has_efirma || false,
      emite_cfdi: profile.emite_cfdi || false,
      declara_mensual: profile.declara_mensual || false
    },
    penalties,
    issues: details
  };
}

/**
 * Extrae y parsea la respuesta del MCP (recomendación/texto)
 */
function extractMcpResponse(result) {
  console.log('[EXTRACT] Extrayendo respuesta de:', JSON.stringify(result).substring(0, 300));
  
  // Si result tiene content (formato MCP estándar de FastMCP)
  // FastMCP envuelve la respuesta en { content: [{ type: 'text', text: '{json}' }] }
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find(c => c.type === 'text');
    if (textContent && textContent.text) {
      console.log('[EXTRACT] Encontrado content array - parseando text...');
      
      // El text puede ser un JSON stringificado de la respuesta de la herramienta
      try {
        const parsed = JSON.parse(textContent.text);
        
        // Si el parsed tiene data.recommendation (estructura de get_fiscal_advice)
        if (parsed.data && parsed.data.recommendation) {
          console.log('[EXTRACT] Parseado JSON de content - encontrado data.recommendation');
          return parsed.data.recommendation;
        }
        
        // Si el parsed tiene data.response (estructura de chat)
        if (parsed.data && parsed.data.response) {
          console.log('[EXTRACT] Parseado JSON de content - encontrado data.response');
          return parsed.data.response;
        }
        
        // Si el parsed tiene recommendation directamente
        if (parsed.recommendation) {
          console.log('[EXTRACT] Parseado JSON de content - encontrado recommendation directo');
          return parsed.recommendation;
        }
        
        // Si no tiene estructura conocida, retornar el parsed completo
        console.log('[EXTRACT] Parseado JSON de content - estructura desconocida, retornando parsed');
        return textContent.text;
        
      } catch (e) {
        // No es JSON, retornar el texto directo
        console.log('[EXTRACT] content.text no es JSON, retornando como string');
        return textContent.text;
      }
    }
  }
  
  // Si result.data.recommendation existe (respuesta directa sin content wrapper)
  if (result.data && result.data.recommendation) {
    console.log('[EXTRACT] Encontrado recommendation en result.data.recommendation');
    return result.data.recommendation;
  }
  
  // Si result tiene data directamente
  if (result.data) {
    if (typeof result.data === 'string') {
      console.log('[EXTRACT] result.data es string directo');
      return result.data;
    }
    if (result.data.response) {
      console.log('[EXTRACT] Encontrado result.data.response');
      return result.data.response;
    }
  }
  
  // Si es string directo
  if (typeof result === 'string') {
    console.log('[EXTRACT] result es string directo');
    // Intentar parsear si es JSON
    try {
      const parsed = JSON.parse(result);
      if (parsed.data && parsed.data.recommendation) {
        return parsed.data.recommendation;
      }
      if (parsed.data && parsed.data.response) {
        return parsed.data.response;
      }
    } catch (e) {
      // No es JSON, retornar como está
    }
    return result;
  }
  
  // Fallback - no debería llegar aquí
  console.warn('[EXTRACT] ⚠️  Fallback activado - estructura no reconocida');
  return 'Error: No se pudo extraer la respuesta del servidor MCP';
}

/**
 * Parsea documentos de la respuesta MCP
 * Compatible con la estructura de get_fiscal_advice y search_fiscal_documents
 */
function extractDocuments(result) {
  console.log('[EXTRACT] Extrayendo documentos de:', JSON.stringify(result).substring(0, 200));
  
  // Caso 1: Si result tiene content con JSON (formato FastMCP)
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find(c => c.type === 'text');
    if (textContent && textContent.text) {
      try {
        const parsed = JSON.parse(textContent.text);
        
        // Buscar sources en data.sources (estructura de get_fiscal_advice)
        if (parsed.data && parsed.data.sources && Array.isArray(parsed.data.sources)) {
          console.log(`[EXTRACT] Encontrados ${parsed.data.sources.length} sources en content->data.sources`);
          return parsed.data.sources;
        }
        
        // Buscar documents en data.documents (estructura de search_fiscal_documents)
        if (parsed.data && parsed.data.documents && Array.isArray(parsed.data.documents)) {
          console.log(`[EXTRACT] Encontrados ${parsed.data.documents.length} documents en content->data.documents`);
          return parsed.data.documents;
        }
        
        // Buscar sources directamente en parsed
        if (parsed.sources && Array.isArray(parsed.sources)) {
          console.log(`[EXTRACT] Encontrados ${parsed.sources.length} sources en content->sources`);
          return parsed.sources;
        }
        
        // Buscar documents directamente en parsed
        if (parsed.documents && Array.isArray(parsed.documents)) {
          console.log(`[EXTRACT] Encontrados ${parsed.documents.length} documents en content->documents`);
          return parsed.documents;
        }
      } catch (e) {
        console.log('[EXTRACT] Error parseando JSON de content:', e.message);
      }
    }
  }
  
  // Caso 2: result.data.sources (respuesta directa sin content wrapper)
  if (result.data && result.data.sources && Array.isArray(result.data.sources)) {
    console.log(`[EXTRACT] Encontrados ${result.data.sources.length} sources en result.data.sources`);
    return result.data.sources;
  }
  
  // Caso 3: result.data.documents (respuesta directa sin content wrapper)
  if (result.data && result.data.documents && Array.isArray(result.data.documents)) {
    console.log(`[EXTRACT] Encontrados ${result.data.documents.length} documents en result.data.documents`);
    return result.data.documents;
  }
  
  console.log('[EXTRACT] No se encontraron documentos/sources');
  return [];
}

/**
 * Handler combinado para /recommendation
 * Implementa el flujo RAG del código Python:
 * 1. Calcula riesgo simple (velocímetro)
 * 2. Genera query semántica del perfil
 * 3. Busca documentos relevantes (RAG)
 * 4. Llama a get_fiscal_advice con el contexto completo
 * 5. Retorna respuesta estructurada para React Native
 */
async function handleRecommendation(params) {
  try {
    console.log('[RECOMMENDATION] Procesando solicitud completa (RAG)...');
    
    // Extraer datos del perfil
    const profile = params.profile || params;
    const {
      actividad,
      ingresos_anuales,
      empleados,
      metodos_pago,
      estado,
      has_rfc,
      has_efirma,
      emite_cfdi,
      declara_mensual,
      regimen_actual,
      contexto_adicional
    } = profile;

    if (!actividad) {
      return {
        statusCode: 400,
        body: {
          error: 'Falta el parámetro "actividad"',
          required: ['actividad']
        }
      };
    }

    // 1. Calcular riesgo simple (velocímetro)
    console.log('[RECOMMENDATION] Calculando riesgo fiscal...');
    const risk = calculateSimpleRisk({
      has_rfc: has_rfc || false,
      has_efirma: has_efirma || false,
      emite_cfdi: emite_cfdi || false,
      declara_mensual: declara_mensual || false
    });
    
    console.log(`[RECOMMENDATION] Riesgo: ${risk.level} (score: ${risk.score}, penalties: ${risk.penalties})`);

    // 2. Llamar a get_fiscal_advice que internamente hace RAG completo
    console.log('[RECOMMENDATION] Llamando get_fiscal_advice con RAG...');
    let recommendation = '';
    let documents = [];
    let sourcesCount = 0;
    
    try {
      const adviceResult = await callMcpTool('get_fiscal_advice', {
        request: {
          actividad,
          ingresos_anuales,
          estado,
          regimen_actual,
          tiene_rfc: has_rfc,
          contexto_adicional
        }
      });
      
      console.log('[RECOMMENDATION] Respuesta de get_fiscal_advice:', JSON.stringify(adviceResult).substring(0, 300));
      
      // Extraer recomendación (extractMcpResponse ya maneja todo el parseo)
      recommendation = extractMcpResponse(adviceResult);
      
      // Extraer sources/documents
      documents = extractDocuments(adviceResult);
      
      sourcesCount = documents.length;
      
      console.log(`[RECOMMENDATION] Recomendación generada con ${sourcesCount} fuentes`);
      
      // Advertencia si no hay fuentes
      if (sourcesCount === 0) {
        console.warn('[RECOMMENDATION] ⚠️  No se encontraron documentos en la base de datos');
        console.warn('[RECOMMENDATION] Posibles causas:');
        console.warn('[RECOMMENDATION] 1. La tabla fiscai_documents está vacía');
        console.warn('[RECOMMENDATION] 2. El threshold (0.6) es muy alto');
        console.warn('[RECOMMENDATION] 3. El embedding no coincide con los documentos');
        console.warn('[RECOMMENDATION] 4. La función RPC match_fiscai_documents tiene un error');
      }
      
    } catch (error) {
      console.error('[RECOMMENDATION] Error generando recomendación:', error.message);
      recommendation = `Error al generar recomendación: ${error.message}`;
    }

    // 3. Construir respuesta estructurada para React Native
    const response = {
      success: true,
      profile: {
        actividad,
        ingresos_anuales: ingresos_anuales || 0,
        empleados: empleados || 0,
        metodos_pago: metodos_pago || [],
        estado: estado || 'No especificado',
        has_rfc: has_rfc || false,
        has_efirma: has_efirma || false,
        emite_cfdi: emite_cfdi || false,
        declara_mensual: declara_mensual || false
      },
      risk: {
        score: risk.score,
        level: risk.level,
        message: risk.message,
        details: risk.details
      },
      recommendation: recommendation,
      sources: documents.map(doc => ({
        title: doc.title || 'Documento fiscal',
        scope: doc.scope || 'General',
        url: doc.url || doc.source_url || 'Libro',
        similarity: doc.similarity || 0.8
      })),
      matches_count: sourcesCount,
      timestamp: new Date().toISOString()
    };

    return {
      statusCode: 200,
      body: response
    };

  } catch (error) {
    console.error('[RECOMMENDATION] Error fatal:', error);
    return {
      statusCode: 500,
      body: {
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Exportar funciones
module.exports = {
  callMcpTool,
  callMcpPrompt,
  handleMcpFiscalAdvice,
  handleMcpChat,
  handleMcpRiskAnalysis,
  handleMcpSearch,
  handleMcpUserContext,
  handleMcpFiscalConsultation,
  handleMcpRiskAssessment,
  handleRecommendation
};
