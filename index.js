/**
 * FiscAI Lambda - MCP Bridge Only
 * Handler simplificado que solo expone endpoints conectados al servidor MCP
 */

const mcpBridge = require('./mcp_bridge');

// ========== UTILIDADES ==========

function extractParams(event) {
  let params = {};

  if (event.queryStringParameters) {
    params = { ...event.queryStringParameters };
  }
  
  if (event.body) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    params = { ...params, ...body };
  }
  
  if (!event.queryStringParameters && !event.body && !event.httpMethod) {
    params = { ...event };
  }

  return params;
}

function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body)
  };
}

function getEndpoint(event) {
  // Extraer path de diferentes formatos de API Gateway
  let path = event.path || event.rawPath || event.requestContext?.resourcePath || '';
  
  // Normalizar path (remover trailing slash)
  path = path.replace(/\/$/, '');
  
  console.log(`[ROUTER] Path: ${path}`);
  
  // Mapeo de endpoints
  if (path.includes('/recommendation')) return 'recommendation';
  if (path.includes('/fiscal-advice') || path.includes('/fiscaladvice')) return 'fiscal-advice';
  if (path.includes('/chat')) return 'chat';
  if (path.includes('/risk-analysis') || path.includes('/risk')) return 'risk-analysis';
  if (path.includes('/search')) return 'search';
  if (path.includes('/places') || path.includes('/map') || path.includes('/places-search')) return 'places';
  if (path.includes('/user-context') || path.includes('/context')) return 'user-context';
  if (path.includes('/fiscal-consultation')) return 'fiscal-consultation';
  if (path.includes('/risk-assessment')) return 'risk-assessment';
  
  // Health check
  if (path.includes('/health')) return 'health';
  
  // Root o info
  if (path === '/' || path === '' || path === '/info') return 'info';
  
  return 'unknown';
}

// ========== HANDLER PRINCIPAL ==========

exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Manejar OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return createResponse(200, { message: 'OK' });
  }

  try {
    const endpoint = getEndpoint(event);
    console.log(`[ROUTER] Endpoint detectado: ${endpoint}`);
    
    const params = extractParams(event);

    // Enrutamiento
    switch (endpoint) {
      
      // ========== ENDPOINT COMBINADO (REACT NATIVE) ==========
      
      case 'recommendation': {
        console.log('[COMBINED] Llamando handleRecommendation...');
        const result = await mcpBridge.handleRecommendation(params);
        return createResponse(result.statusCode, result.body);
      }
      
      // ========== ENDPOINTS MCP ==========
      
      case 'fiscal-advice': {
        console.log('[MCP] Llamando get_fiscal_advice...');
        const result = await mcpBridge.handleMcpFiscalAdvice(params);
        return createResponse(result.statusCode, result.body);
      }
      
      case 'chat': {
        console.log('[MCP] Llamando chat_with_fiscal_assistant...');
        const result = await mcpBridge.handleMcpChat(params);
        return createResponse(result.statusCode, result.body);
      }
      
      case 'risk-analysis': {
        console.log('[MCP] Llamando analyze_fiscal_risk...');
        const result = await mcpBridge.handleMcpRiskAnalysis(params);
        return createResponse(result.statusCode, result.body);
      }
      
      case 'search': {
        console.log('[MCP] Llamando search_fiscal_documents...');
        const result = await mcpBridge.handleMcpSearch(params);
        return createResponse(result.statusCode, result.body);
      }

      case 'places': {
        console.log('[MCP] Llamando search_places (places)...');
        const result = await mcpBridge.handleMcpSearchPlaces(params);
        return createResponse(result.statusCode, result.body);
      }
      
      case 'user-context': {
        console.log('[MCP] Llamando get_user_fiscal_context...');
        const result = await mcpBridge.handleMcpUserContext(params);
        return createResponse(result.statusCode, result.body);
      }
      
      case 'fiscal-consultation': {
        console.log('[MCP] Llamando fiscal_consultation prompt...');
        const result = await mcpBridge.handleMcpFiscalConsultation(params);
        return createResponse(result.statusCode, result.body);
      }
      
      case 'risk-assessment': {
        console.log('[MCP] Llamando risk_assessment prompt...');
        const result = await mcpBridge.handleMcpRiskAssessment(params);
        return createResponse(result.statusCode, result.body);
      }
      
      // ========== HEALTH CHECK ==========
      
      case 'health': {
        return createResponse(200, {
          status: 'healthy',
          service: 'FiscAI Lambda MCP Bridge',
          version: '2.0.0',
          mcp_server: process.env.MCP_SERVER_URL || 'https://fiscmcp.fastmcp.app',
          timestamp: new Date().toISOString()
        });
      }
      
      // ========== INFO / ROOT ==========
      
      case 'info': {
        return createResponse(200, {
          service: 'FiscAI Lambda - MCP Bridge',
          version: '2.0.0',
          description: 'Bridge HTTP para conectar apps con servidor MCP de FiscAI',
          mcp_server: process.env.MCP_SERVER_URL || 'https://fiscmcp.fastmcp.app',
          endpoints: {
            health: '/health',
            recommendation: '/recommendation (Combined endpoint for React Native)',
            fiscalAdvice: '/fiscal-advice',
            chat: '/chat',
            riskAnalysis: '/risk-analysis',
            search: '/search',
            userContext: '/user-context',
            fiscalConsultation: '/fiscal-consultation',
            riskAssessment: '/risk-assessment'
          },
          usage: {
            recommendation: {
              method: 'POST',
              path: '/recommendation',
              description: 'Endpoint combinado que retorna fiscal advice + risk analysis + sources',
              body: {
                profile: {
                  actividad: 'string (required)',
                  ingresos_anuales: 'number (optional)',
                  empleados: 'number (optional)',
                  metodos_pago: 'array (optional)',
                  estado: 'string (optional)',
                  has_rfc: 'boolean (optional)',
                  has_efirma: 'boolean (optional)',
                  emite_cfdi: 'boolean (optional)',
                  declara_mensual: 'boolean (optional)',
                  regimen_actual: 'string (optional)',
                  contexto_adicional: 'string (optional)'
                }
              }
            },
            fiscalAdvice: {
              method: 'POST',
              path: '/fiscal-advice',
              body: {
                actividad: 'string (required)',
                ingresos_anuales: 'number (optional)',
                estado: 'string (optional)',
                regimen_actual: 'string (optional)',
                tiene_rfc: 'boolean (optional)',
                contexto_adicional: 'string (optional)'
              }
            },
            chat: {
              method: 'POST',
              path: '/chat',
              body: {
                message: 'string (required)',
                user_id: 'string (optional)',
                session_id: 'string (optional)'
              }
            },
            riskAnalysis: {
              method: 'POST',
              path: '/risk-analysis',
              body: {
                has_rfc: 'boolean (required)',
                has_efirma: 'boolean (optional)',
                emite_cfdi: 'boolean (optional)',
                declara_mensual: 'boolean (optional)',
                ingresos_anuales: 'number (optional)',
                actividad: 'string (optional)',
                regimen_fiscal: 'string (optional)'
              }
            },
            search: {
              method: 'POST',
              path: '/search',
              body: {
                query: 'string (required)',
                limit: 'number (optional, default: 5)'
              }
            },
            userContext: {
              method: 'POST',
              path: '/user-context',
              body: {
                user_id: 'string (required)'
              }
            }
          },
          examples: {
            recommendation: `
curl -X POST https://your-api-url.com/recommendation \\
  -H "Content-Type: application/json" \\
  -d '{
    "profile": {
      "actividad": "Diseñador gráfico freelance",
      "ingresos_anuales": 450000,
      "empleados": 0,
      "metodos_pago": ["transferencia", "efectivo"],
      "estado": "Ciudad de México",
      "has_rfc": true,
      "has_efirma": true,
      "emite_cfdi": true,
      "declara_mensual": true
    }
  }'
            `.trim(),
            fiscalAdvice: `
curl -X POST https://your-api-url.com/fiscal-advice \\
  -H "Content-Type: application/json" \\
  -d '{
    "actividad": "E-commerce",
    "ingresos_anuales": 500000,
    "estado": "CDMX",
    "tiene_rfc": false
  }'
            `.trim(),
            chat: `
curl -X POST https://your-api-url.com/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "¿Cómo saco mi RFC?",
    "user_id": "user123"
  }'
            `.trim()
          },
          timestamp: new Date().toISOString()
        });
      }
      
      // ========== 404 ==========
      
      default: {
        return createResponse(404, {
          error: 'Endpoint no encontrado',
          endpoint_requested: endpoint,
          path: event.path || event.rawPath || 'N/A',
          method: event.httpMethod || event.requestContext?.http?.method || 'N/A',
          available_endpoints: [
            '/health',
            '/recommendation (Combined)',
            '/fiscal-advice',
            '/chat',
            '/risk-analysis',
            '/search',
            '/user-context',
            '/fiscal-consultation',
            '/risk-assessment'
          ],
          tip: 'Accede a / o /info para ver la documentación completa',
          timestamp: new Date().toISOString()
        });
      }
    }

  } catch (error) {
    console.error('[ERROR]', error);
    
    return createResponse(500, {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
};
