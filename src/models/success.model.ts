import { status as HTTP_STATUS } from 'http-status'
export class AppSuccess<T = any> {
  message: string
  status: number
  data: T

  constructor({ message, data, status = HTTP_STATUS.OK }: { message: string; data: T; status?: number }) {
    this.message = message
    this.status = status
    this.data = data
  }
}
