import { USER_VERIFY_STATUS } from '~/constants/enums'

export type UserIdentity = {
  userId: string
  verify: USER_VERIFY_STATUS
}
