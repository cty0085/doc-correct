import axios from "axios";

const API = axios.create({
  baseURL: "/api",
  timeout: 60000,
  headers: {
    "Content-Type": "application/json"
  }
});

// ����������
API.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ��Ӧ������
API.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    console.error("API�������:", error);
    
    if (error.response) {
      const message = error.response.data?.error || error.response.data?.message || "����ʧ��";
      return Promise.reject(new Error(message));
    } else if (error.request) {
      return Promise.reject(new Error("������������˷����Ƿ����"));
    } else {
      return Promise.reject(error);
    }
  }
);

// ��������
export const testConnection = () => {
  return API.get("/test");
};

// �ļ��ϴ�
export const uploadFile = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  
  return API.post("/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data"
    }
  });
};

// AI���
export const aiCheck = (text) => {
  return API.post("/check/ai", { text });
};

// �ֶ����
export const manualCheck = (text) => {
  return API.post("/check/manual", { text });
};

export default API;
