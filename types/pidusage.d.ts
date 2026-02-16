declare module 'pidusage' {
  export interface Status {
    cpu: number
    memory: number
    ppid?: number
    pid?: number
    ctime?: number
    elapsed?: number
    timestamp?: number
  }

  interface PidUsageFn {
    (pid: number): Promise<Status>
    clear: () => void
  }

  const pidusage: PidUsageFn
  export default pidusage
}
