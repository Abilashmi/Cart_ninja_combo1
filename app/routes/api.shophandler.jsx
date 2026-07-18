import fs from "fs";
import { BASE_PHP_URL } from "../utils/api-helpers";

// The loader handles GET requests (like a page refresh)
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  
  // For GET requests, we get parameters from the URL query string
  // Example: /api/shophandler?shop=myshop.myshopify.com&action=refresh&details=test
  const shop = url.searchParams.get("shop");
  const actionParam = url.searchParams.get("action");
  const details = url.searchParams.get("details");

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (!shop) {
    return Response.json({ error: "Shop parameter is required" }, { status: 400, headers: corsHeaders });
  }

  const logAction = actionParam || 'error';
  
  try {
    const phpResponse = await fetch(`${BASE_PHP_URL}/shop_logger.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop,
        action: logAction,
        details: details || "",
      }),
    });

    let result = {};
    try {
      result = await phpResponse.json();
    } catch(e) {
      console.error("PHP Response was not JSON", e);
    }

    return Response.json({
      success: true,
      message: "GET Error log successfully forwarded to remote PHP server.",
      php_result: result
    }, { status: 200, headers: corsHeaders });

  } catch (error) {
    console.error("Shop Handler GET Error:", error);
    return Response.json(
      { error: "Internal server error processing shop log" },
      { status: 500, headers: corsHeaders }
    );
  }
};

export const action = async ({ request }) => {
  if (request.method !== "POST" && request.method !== "OPTIONS") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    const { shop, action, details } = body;

    if (!shop) {
      return Response.json({ error: "Shop parameter is required" }, { status: 400, headers: corsHeaders });
    }

    // Only log if the action is an error, or we default to logging it as an error action
    const logAction = action || 'error';
    
    // Forward the log securely to your remote PHP endpoint
    const phpResponse = await fetch(`${BASE_PHP_URL}/shop_logger.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop,
        action: logAction,
        details: details || "",
      }),
    });

    // Attempt to parse the PHP response
    let result = {};
    try {
      result = await phpResponse.json();
    } catch(e) {
      console.error("PHP Response was not JSON", e);
    }

    return Response.json({
      success: true,
      message: "POST Error log successfully forwarded to remote PHP server.",
      php_result: result
    }, { status: 200, headers: corsHeaders });

  } catch (error) {
    console.error("Shop Handler Error:", error);
    return Response.json(
      { error: "Internal server error processing shop log" },
      { status: 500, headers: corsHeaders }
    );
  }
};
