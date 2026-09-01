export type AidboxUserInfo = {
    id: string,
    data?: {
        roles?: string[],
        groups?: string[]
    },
    name?: { formatted?: string }
    resourceType: string
    sub: string,
    isAdmin: boolean
}

export interface AidboxSession {
    tokenType: string
    accessToken: string;
    userInfo: AidboxUserInfo;
    accessTokenExpires?: number;
    error?: string;
}