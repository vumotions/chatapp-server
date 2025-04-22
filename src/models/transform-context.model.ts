export class TransformContext<T> {
  data: T
  context: any

  constructor({ data, context }: { data: T; context?: any }) {
    this.data = data
    this.context = context || {}
  }
}
