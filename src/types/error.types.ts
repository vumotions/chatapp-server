// Định nghĩa interface cho Socket Error
export interface SocketError extends Error {
  code?: string;
  data?: any;
}