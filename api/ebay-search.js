// Vercel Serverless Function for eBay API Proxy
// File: api/ebay-search.js

const CLIENT_ID = 'AndrewFe-PuckGeni-PRD-2814c567f-c12e8586';
const CLIENT_SECRET = 'PRD-814c567f9245-9f1c-4068-9b88-eba4';
const BASE_URL = 'https://api.ebay.com';

// In-memory token cache (Vercel functions are stateless, so this resets on each cold start)
let tokenCache = {
  token: null,
  expiry: null
};

async function getApplicationToken() {
  // Check if we have a valid cached token
  if (tokenCache.token && tokenCache.expiry && Date.now() < tokenCache.expiry) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const scope = 'https://api.ebay.com/oauth/api_scope';

  try {
    const response = await fetch(`${BASE_URL}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token request failed: ${error.error_description || error.error}`);
    }

    const data = await response.json();
    
    // Cache the token with 1-minute buffer before expiry
    tokenCache.token = data.access_token;
    tokenCache.expiry = Date.now() + (data.expires_in * 1000) - 60000;
    
    return tokenCache.token;
  } catch (error) {
    console.error('Error getting token:', error);
    throw error;
  }
}

async function searchEbayItems(query, options = {}) {
  const token = await getApplicationToken();
  
  const params = new URLSearchParams({
    q: query,
    limit: options.limit || 20,
    offset: options.offset || 0,
    fieldgroups: 'EXTENDED' // Get detailed info including shipping and buying options
  });

  // Add optional parameters
  if (options.sort) params.append('sort', options.sort);
  if (options.category_ids) params.append('category_ids', options.category_ids);
  if (options.filter) params.append('filter', options.filter);

  try {
    const response = await fetch(`${BASE_URL}/buy/browse/v1/item_summary/search?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': options.marketplace || 'EBAY_US',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Search failed: ${error.errors?.[0]?.message || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error searching items:', error);
    throw error;
  }
}

// Main Vercel serverless function handler
export default async function handler(req, res) {
  // Enable CORS for all origins (you can restrict this to your domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      q: query, 
      limit = 20, 
      offset = 0, 
      sort, 
      category_ids, 
      filter,
      marketplace = 'EBAY_US'
    } = req.query;

    // Validate required parameters
    if (!query || query.trim() === '') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    // Search eBay items
    const searchResults = await searchEbayItems(query, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      sort,
      category_ids,
      filter,
      marketplace
    });

    // Return successful response
    res.status(200).json({
      success: true,
      data: searchResults,
      query: {
        q: query,
        limit: parseInt(limit),
        offset: parseInt(offset),
        sort,
        marketplace
      }
    });

  } catch (error) {
    console.error('API Error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

// Alternative endpoint for getting item details
// File: api/ebay-item.js
export async function getItemHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { itemId } = req.query;

    if (!itemId) {
      return res.status(400).json({ error: 'Item ID is required' });
    }

    const token = await getApplicationToken();
    
    const response = await fetch(`${BASE_URL}/buy/browse/v1/item/${itemId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Item details failed: ${error.errors?.[0]?.message || response.statusText}`);
    }

    const itemData = await response.json();

    res.status(200).json({
      success: true,
      data: itemData
    });

  } catch (error) {
    console.error('Item API Error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
