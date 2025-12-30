import axios from "axios";
import { tokenStore } from "@/lib/api/token-store";
import { refreshSession } from "@/lib/api/auth.client";

// Add the default header as requested:
axios.defaults.headers.common["X-Client-Type"] = "web";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
  withCredentials: true, 
});

let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null) => {
  failedQueue.forEach(promise => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  console.log(token,"=======frontend-tokenStore")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  res => res,
  async error => {
    const originalRequest = error.config;
    console.log(originalRequest,originalRequest._retry,"========================originalRequest")
    console.log(error.response?.status === 401 && !originalRequest._retry,isRefreshing,"====error.response?.data.status === 401 && !originalRequest._retry")

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        console.log("isRefreshing is true, queuing the request", { originalRequest, failedQueue });
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          console.log("Token received from processQueue for retry:", token, "=====______token");
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshSession();
        console.log(newToken,"=======newToken")
        if (!newToken) {
          processQueue(new Error("No new token received"), null);
          tokenStore.clear();
          window.location.href = "/login";
          return Promise.reject(new Error("No new token received"));
        }
        tokenStore.set(newToken);
        processQueue(null, newToken);
        console.log("new token hit")

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (err) {
        console.log(err,"======axios err")
        processQueue(err, null);
        tokenStore.clear();
        window.location.href = "/login";
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
