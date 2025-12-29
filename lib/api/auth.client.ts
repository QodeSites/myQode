import api from "./axios";

export async function refreshSession(): Promise<string> {
  const res = await api.post("/api/auth/refresh");
  console.log(res,"========res-frontend")
  return res.data.accessToken;
}

