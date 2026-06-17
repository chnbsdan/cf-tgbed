/**
 * 认证管理模块
 */

export function authenticate(request, config) {
  const cookies = request.headers.get("Cookie") || "";
  const authToken = cookies.match(/auth_token=([^;]+)/);
  
  if (!authToken) return false;
  
  try {
    const tokenData = JSON.parse(atob(authToken[1]));
    const now = Date.now();
    
    if (now > tokenData.expiration) {
      console.log("Token已过期");
      return false;
    }
    
    return tokenData.username === config.username;
  } catch (error) {
    console.error("Token验证失败:", error);
    return false;
  }
}

export function createAuthToken(username, config) {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + config.cookie);
  
  const tokenData = JSON.stringify({
    username: username,
    expiration: expirationDate.getTime()
  });
  
  const token = btoa(tokenData);
  return {
    token,
    expires: expirationDate.toUTCString()
  };
}

export function requireAuth(handler) {
  return async (request, config) => {
    if (config.enableAuth && !authenticate(request, config)) {
      return Response.redirect(`${new URL(request.url).origin}/login`, 302);
    }
    return handler(request, config);
  };
}

export function validateCredentials(username, password, config) {
  return username === config.username && password === config.password;
}
