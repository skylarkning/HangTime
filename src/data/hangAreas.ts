/**
 * Describes a hang the way a triager would before reading the whole stack:
 * which area of the browser it is in, by what mechanism the thread was stuck,
 * and in what context it happened. The list and the detail pane use this to
 * name a hang by its engineering problem rather than by the frame it happened
 * to stop on (`WaitOnAddress kernelbase` says very little; "Startup cache: lock
 * wait, during JS module loading" says where to look).
 *
 * Three separate dimensions, because they answer different questions:
 *  - **Mechanism**: what the thread was doing when it was sampled. A file
 *    operation, a lock wait, a synchronous IPC round trip, CPU work. Read from
 *    the leaf side of the stack. It says where the thread was, not why it was
 *    slow: a `CreateFileW` frame does not by itself mean the disk is slow.
 *  - **Area**: the browser subsystem the hang belongs to (fonts, Places,
 *    session restore, networking...). The innermost frame that names one.
 *    The next different area further out is reported as the activity ("during
 *    JS module loading").
 *  - **Context**: when it happened (startup, shutdown, while the user was
 *    interacting, with a paint pending), from the hang's annotations.
 *
 * Everything here is evidence-based and shows its work: each answer carries the
 * stack depth of the frame that decided it, so the UI can point at that frame.
 * It is a description to investigate, not a confirmed root cause.
 *
 * The artifact has no source paths, only function and library names, so this
 * matches on names. Matching every rule against every frame of every signature
 * would be slow at production scale (~150k functions, ~10M frame visits), so
 * each function is classified once into a FrameTable and a stack is then
 * classified with array lookups.
 */

import type { AnnotationStats } from "@/processing/types";

// -- Mechanisms ---------------------------------------------------------------

export type MechanismId =
  | "file-io"
  | "registry"
  | "library-load"
  | "process-launch"
  | "clipboard"
  | "gpu-driver"
  | "network"
  | "com-call"
  | "lock-wait"
  | "blocking-wait"
  | "sleep"
  | "memory-copy"
  | "memory-alloc"
  | "window-message"
  | "event-loop"
  | "sync-ipc"
  | "idle-wait"
  | "thread-join"
  | "serialization"
  | "script-compile"
  | "gc"
  | "cc"
  | "js"
  | "cpu"
  | "system-call"
  | "unknown";

/**
 * How a mechanism is recognised:
 *  - `boundary`: the thread left Firefox code for a system call or primitive.
 *    Only counts when no Firefox work sits between it and the leaf, since a
 *    window procedure called back from `CallWindowProcW` is Firefox running,
 *    not Windows.
 *  - `activity`: Firefox-level work named by its own functions (a sync IPC
 *    send, JSON serialization). Searched for within the first frames.
 *  - `phase`: GC and cycle collection. Anything below them on the stack is
 *    part of the collection, so they are searched for at any depth.
 *  - `fallback`: what is left when no rule matched.
 */
type MechanismKind = "boundary" | "activity" | "phase" | "fallback";

/**
 * A primitive's family. Locks and memory operations are what most hangs stop
 * on, and say little on their own; a nearby activity that "explains" the
 * family is the better answer (a condition-variable wait inside
 * `MessageChannel::WaitForSyncNotify` is a synchronous IPC round trip).
 */
type Family = "wait" | "memory";

interface MechanismInfo {
  label: string;
  /** The label as it reads mid-sentence, after an area name. */
  phrase: string;
  kind: MechanismKind;
  /** For primitives: the family an activity can explain. */
  family?: Family;
  /** For activities and phases: the primitive families they explain. */
  explains?: Family[];
  /** Strong boundaries (a file operation) win outright over activities. */
  strong?: boolean;
  /** One line for tooltips and the Guide. */
  blurb: string;
}

export const MECHANISMS: Record<MechanismId, MechanismInfo> = {
  "file-io": {
    label: "File I/O",
    phrase: "file I/O",
    kind: "boundary",
    strong: true,
    blurb:
      "Sampled inside a file operation (open, read, write, delete, metadata). The disk may not be the cause: antivirus, network drives and locks all stall here too.",
  },
  registry: {
    label: "Registry access",
    phrase: "registry access",
    kind: "boundary",
    strong: true,
    blurb: "Sampled reading or writing the Windows registry.",
  },
  "library-load": {
    label: "Library loading",
    phrase: "library loading",
    kind: "boundary",
    strong: true,
    blurb: "Sampled loading a DLL or shared library, often under the OS loader lock.",
  },
  "process-launch": {
    label: "Process launch",
    phrase: "process launch",
    kind: "boundary",
    strong: true,
    blurb: "Sampled starting another process.",
  },
  clipboard: {
    label: "Clipboard access",
    phrase: "clipboard access",
    kind: "boundary",
    strong: true,
    blurb:
      "Sampled in an OS clipboard call, which can block on whichever application owns the clipboard.",
  },
  "gpu-driver": {
    label: "GPU driver call",
    phrase: "GPU driver call",
    kind: "boundary",
    strong: true,
    blurb: "Sampled inside a graphics driver or graphics API library.",
  },
  network: {
    label: "Network or DNS",
    phrase: "network or DNS call",
    kind: "boundary",
    strong: true,
    blurb: "Sampled in a blocking network or DNS call on the main thread.",
  },
  "com-call": {
    label: "COM call",
    phrase: "COM call",
    kind: "boundary",
    strong: true,
    blurb:
      "Sampled in a COM or RPC call, frequently to another process (the shell, an input method, a screen reader) that has not answered.",
  },
  "lock-wait": {
    label: "Lock wait",
    phrase: "lock wait",
    kind: "boundary",
    family: "wait",
    blurb: "Waiting to acquire a lock or on a condition variable another thread holds.",
  },
  "blocking-wait": {
    label: "Blocking wait",
    phrase: "blocking wait",
    kind: "boundary",
    family: "wait",
    blurb: "Waiting on an OS event, handle or poll for something else to finish.",
  },
  sleep: {
    label: "Sleep",
    phrase: "sleep",
    kind: "boundary",
    family: "wait",
    blurb: "The thread deliberately slept.",
  },
  "memory-copy": {
    label: "Memory copy",
    phrase: "memory copy",
    kind: "boundary",
    family: "memory",
    blurb: "Copying, filling or comparing a large block of memory.",
  },
  "memory-alloc": {
    label: "Memory allocation",
    phrase: "memory allocation",
    kind: "boundary",
    family: "memory",
    blurb: "Allocating or freeing memory, including returning pages to the OS.",
  },
  "window-message": {
    label: "Window message",
    phrase: "window message",
    kind: "boundary",
    blurb:
      "Inside native window message dispatch, typically waiting on another window's procedure or the OS window manager.",
  },
  "event-loop": {
    label: "Native event loop",
    phrase: "native event loop",
    kind: "boundary",
    blurb:
      "Inside the OS event loop fetching messages. Input-method and accessibility hooks run here, so the time is often theirs.",
  },
  "sync-ipc": {
    label: "Synchronous IPC",
    phrase: "synchronous IPC",
    kind: "activity",
    explains: ["wait", "memory"],
    blurb: "Blocked waiting for another Firefox process to answer a synchronous IPC message.",
  },
  "idle-wait": {
    label: "Idle wait",
    phrase: "idle wait",
    kind: "activity",
    explains: ["wait"],
    blurb:
      "The main thread was waiting for its next task. Usually a reporting artifact rather than a real hang.",
  },
  "thread-join": {
    label: "Thread shutdown",
    phrase: "thread shutdown wait",
    kind: "activity",
    explains: ["wait"],
    blurb: "Waiting for another thread to finish or shut down.",
  },
  serialization: {
    label: "Serialization",
    phrase: "serialization",
    kind: "activity",
    explains: ["memory"],
    blurb: "Serializing or parsing data: JSON, structured clone.",
  },
  "script-compile": {
    label: "Script compilation",
    phrase: "script compilation",
    kind: "activity",
    explains: ["memory"],
    blurb: "Parsing, compiling or decoding JavaScript.",
  },
  gc: {
    label: "Garbage collection",
    phrase: "garbage collection",
    kind: "phase",
    explains: ["wait", "memory"],
    blurb: "Inside a JavaScript garbage collection.",
  },
  cc: {
    label: "Cycle collection",
    phrase: "cycle collection",
    kind: "phase",
    explains: ["wait", "memory"],
    blurb: "Inside cycle collection or the deferred finalization that follows it.",
  },
  js: {
    label: "JavaScript execution",
    phrase: "JavaScript execution",
    kind: "fallback",
    blurb: "Running JavaScript, interpreted or JIT-compiled.",
  },
  cpu: {
    label: "CPU work",
    phrase: "CPU work",
    kind: "fallback",
    blurb: "Running Firefox code with no blocking call at the leaf.",
  },
  "system-call": {
    label: "System library call",
    phrase: "system library call",
    kind: "fallback",
    blurb: "Inside a system library that no rule recognises.",
  },
  unknown: {
    label: "Unknown",
    phrase: "unsymbolicated code",
    kind: "fallback",
    blurb: "The leaf frames aren't symbolicated, so the mechanism can't be read.",
  },
};

interface MechanismRule {
  match: string;
  /** Match against the library name rather than the function name. */
  lib?: boolean;
  /** Require the whole symbol to equal `match` (for short POSIX names). */
  exact?: boolean;
  mechanism: MechanismId;
  /** The operation, for file I/O: "open", "delete", ... */
  op?: string;
}

/**
 * Ordered so the more specific rule for a frame comes first; the first rule
 * that matches a frame decides it.
 */
const MECHANISM_RULES: MechanismRule[] = [
  // -- File I/O, with the operation it names --
  { match: "DeleteFile", mechanism: "file-io", op: "delete" },
  { match: "NtDeleteFile", mechanism: "file-io", op: "delete" },
  { match: "RemoveDirectory", mechanism: "file-io", op: "delete" },
  { match: "unlink", exact: true, mechanism: "file-io", op: "delete" },
  { match: "rmdir", exact: true, mechanism: "file-io", op: "delete" },
  { match: "CreateDirectory", mechanism: "file-io", op: "create directory" },
  { match: "mkdir", exact: true, mechanism: "file-io", op: "create directory" },
  { match: "CreateFile", mechanism: "file-io", op: "open" },
  { match: "NtCreateFile", mechanism: "file-io", op: "open" },
  { match: "NtOpenFile", mechanism: "file-io", op: "open" },
  { match: "open", exact: true, mechanism: "file-io", op: "open" },
  { match: "open64", exact: true, mechanism: "file-io", op: "open" },
  { match: "openat", exact: true, mechanism: "file-io", op: "open" },
  { match: "__open_nocancel", exact: true, mechanism: "file-io", op: "open" },
  { match: "fopen", exact: true, mechanism: "file-io", op: "open" },
  { match: "ReadFile", mechanism: "file-io", op: "read" },
  { match: "NtReadFile", mechanism: "file-io", op: "read" },
  { match: "read", exact: true, mechanism: "file-io", op: "read" },
  { match: "pread", exact: true, mechanism: "file-io", op: "read" },
  { match: "__pread_nocancel", exact: true, mechanism: "file-io", op: "read" },
  { match: "__read_nocancel", exact: true, mechanism: "file-io", op: "read" },
  { match: "WriteFile", mechanism: "file-io", op: "write" },
  { match: "NtWriteFile", mechanism: "file-io", op: "write" },
  { match: "write", exact: true, mechanism: "file-io", op: "write" },
  { match: "pwrite", exact: true, mechanism: "file-io", op: "write" },
  { match: "FlushFileBuffers", mechanism: "file-io", op: "flush" },
  { match: "NtFlushBuffersFile", mechanism: "file-io", op: "flush" },
  { match: "fsync", exact: true, mechanism: "file-io", op: "flush" },
  { match: "fdatasync", exact: true, mechanism: "file-io", op: "flush" },
  { match: "GetFileAttributes", mechanism: "file-io", op: "metadata" },
  { match: "QueryAttributesFile", mechanism: "file-io", op: "metadata" },
  { match: "QueryFullAttributesFile", mechanism: "file-io", op: "metadata" },
  { match: "NtQueryInformationFile", mechanism: "file-io", op: "metadata" },
  { match: "NtQueryVolumeInformationFile", mechanism: "file-io", op: "metadata" },
  { match: "GetFileInformationByHandle", mechanism: "file-io", op: "metadata" },
  { match: "GetFinalPathNameByHandle", mechanism: "file-io", op: "metadata" },
  { match: "GetDiskFreeSpace", mechanism: "file-io", op: "metadata" },
  { match: "stat", exact: true, mechanism: "file-io", op: "metadata" },
  { match: "stat64", exact: true, mechanism: "file-io", op: "metadata" },
  { match: "lstat", exact: true, mechanism: "file-io", op: "metadata" },
  { match: "lstat64", exact: true, mechanism: "file-io", op: "metadata" },
  { match: "fstat", exact: true, mechanism: "file-io", op: "metadata" },
  { match: "access", exact: true, mechanism: "file-io", op: "metadata" },
  { match: "getattrlist", exact: true, mechanism: "file-io", op: "metadata" },
  { match: "FindFirstFile", mechanism: "file-io", op: "list directory" },
  { match: "FindNextFile", mechanism: "file-io", op: "list directory" },
  { match: "NtQueryDirectoryFile", mechanism: "file-io", op: "list directory" },
  { match: "readdir", exact: true, mechanism: "file-io", op: "list directory" },
  { match: "MoveFile", mechanism: "file-io", op: "rename" },
  { match: "ReplaceFile", mechanism: "file-io", op: "rename" },
  { match: "rename", exact: true, mechanism: "file-io", op: "rename" },
  { match: "CopyFile", mechanism: "file-io", op: "copy" },
  { match: "LockFile", mechanism: "file-io", op: "lock" },
  { match: "NtLockFile", mechanism: "file-io", op: "lock" },
  { match: "NtSetInformationFile", mechanism: "file-io", op: "set info" },
  { match: "SetEndOfFile", mechanism: "file-io", op: "set info" },
  { match: "MapViewOfFile", mechanism: "file-io", op: "map" },
  { match: "NtCreateSection", mechanism: "file-io", op: "map" },

  // -- Other strong boundaries --
  { match: "RegQueryValue", mechanism: "registry" },
  { match: "RegGetValue", mechanism: "registry" },
  { match: "RegOpenKey", mechanism: "registry" },
  { match: "RegEnumKey", mechanism: "registry" },
  { match: "RegEnumValue", mechanism: "registry" },
  { match: "RegSetValue", mechanism: "registry" },
  { match: "RegCreateKey", mechanism: "registry" },
  { match: "RegNotifyChangeKeyValue", mechanism: "registry" },
  { match: "NtQueryValueKey", mechanism: "registry" },
  { match: "NtOpenKey", mechanism: "registry" },
  { match: "NtEnumerateKey", mechanism: "registry" },
  { match: "LoadLibrary", mechanism: "library-load" },
  { match: "LdrLoadDll", mechanism: "library-load" },
  { match: "LdrpLoadDll", mechanism: "library-load" },
  { match: "LdrGetProcedureAddress", mechanism: "library-load" },
  { match: "dlopen", mechanism: "library-load" },
  { match: "CreateProcess", mechanism: "process-launch" },
  { match: "ShellExecute", mechanism: "process-launch" },
  { match: "posix_spawn", mechanism: "process-launch" },
  { match: "base::LaunchApp", mechanism: "process-launch" },
  { match: "OleGetClipboard", mechanism: "clipboard" },
  { match: "OleSetClipboard", mechanism: "clipboard" },
  { match: "OleFlushClipboard", mechanism: "clipboard" },
  { match: "OleIsCurrentClipboard", mechanism: "clipboard" },
  { match: "CClipDataObject", mechanism: "clipboard" },
  { match: "GetClipboardData", mechanism: "clipboard" },
  { match: "OpenClipboard", mechanism: "clipboard" },
  { match: "NSPasteboard", mechanism: "clipboard" },
  { match: "gtk_clipboard_wait", mechanism: "clipboard" },
  { match: "getaddrinfo", mechanism: "network" },
  { match: "GetAddrInfo", mechanism: "network" },
  { match: "DnsQuery", mechanism: "network" },
  { match: "gethostbyname", mechanism: "network" },
  { match: "WSAConnect", mechanism: "network" },
  { match: "WinHttp", mechanism: "network" },
  { match: "d3d11", lib: true, mechanism: "gpu-driver" },
  { match: "d3d10", lib: true, mechanism: "gpu-driver" },
  { match: "d3d9", lib: true, mechanism: "gpu-driver" },
  { match: "dxgi", lib: true, mechanism: "gpu-driver" },
  { match: "dcomp", lib: true, mechanism: "gpu-driver" },
  { match: "nvwgf2um", lib: true, mechanism: "gpu-driver" },
  { match: "nvd3dum", lib: true, mechanism: "gpu-driver" },
  { match: "nvoglv", lib: true, mechanism: "gpu-driver" },
  { match: "nvldumd", lib: true, mechanism: "gpu-driver" },
  { match: "igd10", lib: true, mechanism: "gpu-driver" },
  { match: "igd11", lib: true, mechanism: "gpu-driver" },
  { match: "igd12", lib: true, mechanism: "gpu-driver" },
  { match: "igdumd", lib: true, mechanism: "gpu-driver" },
  { match: "igc64", lib: true, mechanism: "gpu-driver" },
  { match: "amdxx", lib: true, mechanism: "gpu-driver" },
  { match: "atidxx", lib: true, mechanism: "gpu-driver" },
  { match: "aticfx", lib: true, mechanism: "gpu-driver" },
  { match: "atiumd", lib: true, mechanism: "gpu-driver" },
  { match: "opengl32", lib: true, mechanism: "gpu-driver" },
  { match: "libGL", lib: true, mechanism: "gpu-driver" },
  { match: "libEGL", lib: true, mechanism: "gpu-driver" },
  { match: "libnvidia", lib: true, mechanism: "gpu-driver" },
  { match: "_dri.so", lib: true, mechanism: "gpu-driver" },
  { match: "AGXMetal", lib: true, mechanism: "gpu-driver" },
  { match: "libvulkan", lib: true, mechanism: "gpu-driver" },
  { match: "ObjectStubless", mechanism: "com-call" },
  { match: "NdrClientCall", mechanism: "com-call" },
  { match: "Ndr64AsyncClientCall", mechanism: "com-call" },
  { match: "NdrpClientCall", mechanism: "com-call" },
  { match: "CoCreateInstance", mechanism: "com-call" },
  { match: "CoGetClassObject", mechanism: "com-call" },
  { match: "CoWaitForMultipleHandles", mechanism: "com-call" },
  { match: "CoUninitialize", mechanism: "com-call" },
  { match: "rpcrt4", lib: true, mechanism: "com-call" },

  // -- Primitives: what most hangs stop on --
  { match: "WaitOnAddress", mechanism: "lock-wait" },
  { match: "SRWLock", mechanism: "lock-wait" },
  { match: "SleepConditionVariable", mechanism: "lock-wait" },
  { match: "EnterCriticalSection", mechanism: "lock-wait" },
  { match: "RtlpWaitOnCriticalSection", mechanism: "lock-wait" },
  { match: "NtWaitForAlertByThreadId", mechanism: "lock-wait" },
  { match: "NtWaitForKeyedEvent", mechanism: "lock-wait" },
  { match: "MutexImpl::", mechanism: "lock-wait" },
  { match: "FutexImpl", mechanism: "lock-wait" },
  { match: "LockContended", mechanism: "lock-wait" },
  { match: "Mutex::Lock", mechanism: "lock-wait" },
  { match: "Mutex::Unlock", mechanism: "lock-wait" },
  { match: "Monitor::Wait", mechanism: "lock-wait" },
  { match: "CondVar::Wait", mechanism: "lock-wait" },
  { match: "AutoLock<MaybeMutex>", mechanism: "lock-wait" },
  { match: "ConditionVariableImpl::wait", mechanism: "lock-wait" },
  { match: "OffTheBooksMutex", mechanism: "lock-wait" },
  { match: "OffTheBooksCondVar", mechanism: "lock-wait" },
  { match: "RWLockImpl", mechanism: "lock-wait" },
  { match: "pthread_mutex_lock", mechanism: "lock-wait" },
  { match: "pthread_cond_wait", mechanism: "lock-wait" },
  { match: "pthread_cond_timedwait", mechanism: "lock-wait" },
  { match: "pthread_rwlock", mechanism: "lock-wait" },
  { match: "__psynch_mutexwait", mechanism: "lock-wait" },
  { match: "__psynch_cvwait", mechanism: "lock-wait" },
  { match: "__psynch_rw", mechanism: "lock-wait" },
  { match: "_pthread_mutex_firstfit_lock_wait", mechanism: "lock-wait" },
  { match: "os_unfair_lock", mechanism: "lock-wait" },
  { match: "__ulock_wait", mechanism: "lock-wait" },
  { match: "futex", mechanism: "lock-wait" },
  { match: "__lll_lock_wait", mechanism: "lock-wait" },
  { match: "MsgWaitForMultipleObjects", mechanism: "event-loop" },
  { match: "UserMsgWaitForMultipleObjects", mechanism: "event-loop" },
  { match: "WaitForSingleObject", mechanism: "blocking-wait" },
  { match: "WaitForMultipleObjects", mechanism: "blocking-wait" },
  { match: "NtWaitForSingleObject", mechanism: "blocking-wait" },
  { match: "NtWaitForMultipleObjects", mechanism: "blocking-wait" },
  { match: "ZwWaitForSingleObject", mechanism: "blocking-wait" },
  { match: "ZwWaitForMultipleObjects", mechanism: "blocking-wait" },
  { match: "semaphore_wait", mechanism: "blocking-wait" },
  { match: "dispatch_semaphore_wait", mechanism: "blocking-wait" },
  { match: "mach_msg", mechanism: "blocking-wait" },
  { match: "PR_WaitCondVar", mechanism: "blocking-wait" },
  { match: "PR_Wait", exact: true, mechanism: "blocking-wait" },
  { match: "SleepEx", mechanism: "sleep" },
  { match: "Sleep", exact: true, mechanism: "sleep" },
  { match: "NtDelayExecution", mechanism: "sleep" },
  { match: "PR_Sleep", mechanism: "sleep" },
  { match: "usleep", exact: true, mechanism: "sleep" },
  { match: "nanosleep", exact: true, mechanism: "sleep" },
  { match: "memcpy", mechanism: "memory-copy" },
  { match: "memmove", mechanism: "memory-copy" },
  { match: "memset", mechanism: "memory-copy" },
  { match: "memcmp", mechanism: "memory-copy" },
  { match: "bzero", mechanism: "memory-copy" },
  { match: "copy_nonoverlapping", mechanism: "memory-copy" },
  { match: "RtlCopyMemory", mechanism: "memory-copy" },
  { match: "RtlMoveMemory", mechanism: "memory-copy" },
  { match: "VirtualAlloc", mechanism: "memory-alloc" },
  { match: "VirtualFree", mechanism: "memory-alloc" },
  { match: "VirtualProtect", mechanism: "memory-alloc" },
  { match: "NtAllocateVirtualMemory", mechanism: "memory-alloc" },
  { match: "NtFreeVirtualMemory", mechanism: "memory-alloc" },
  { match: "RtlAllocateHeap", mechanism: "memory-alloc" },
  { match: "RtlFreeHeap", mechanism: "memory-alloc" },
  { match: "HeapAlloc", mechanism: "memory-alloc" },
  { match: "HeapFree", mechanism: "memory-alloc" },
  { match: "mmap", exact: true, mechanism: "memory-alloc" },
  { match: "munmap", exact: true, mechanism: "memory-alloc" },
  { match: "madvise", exact: true, mechanism: "memory-alloc" },
  { match: "malloc", exact: true, mechanism: "memory-alloc" },
  { match: "realloc", exact: true, mechanism: "memory-alloc" },
  { match: "calloc", exact: true, mechanism: "memory-alloc" },
  { match: "free", exact: true, mechanism: "memory-alloc" },
  { match: "posix_memalign", exact: true, mechanism: "memory-alloc" },
  { match: "moz_xmalloc", exact: true, mechanism: "memory-alloc" },
  { match: "moz_xrealloc", exact: true, mechanism: "memory-alloc" },
  { match: "moz_xcalloc", exact: true, mechanism: "memory-alloc" },
  { match: "je_malloc", exact: true, mechanism: "memory-alloc" },
  { match: "je_free", exact: true, mechanism: "memory-alloc" },
  { match: "je_realloc", exact: true, mechanism: "memory-alloc" },
  { match: "je_calloc", exact: true, mechanism: "memory-alloc" },
  { match: "::malloc", mechanism: "memory-alloc" },
  { match: "::free", mechanism: "memory-alloc" },
  { match: "::realloc", mechanism: "memory-alloc" },
  { match: "::calloc", mechanism: "memory-alloc" },
  { match: "malloc_zone_", mechanism: "memory-alloc" },
  { match: "moz_arena_", mechanism: "memory-alloc" },
  { match: "arena_dalloc", mechanism: "memory-alloc" },
  { match: "arena_malloc", mechanism: "memory-alloc" },
  { match: "arena_ralloc", mechanism: "memory-alloc" },
  { match: "arena_t::", mechanism: "memory-alloc" },
  { match: "pages_unmap", mechanism: "memory-alloc" },
  { match: "pages_map", mechanism: "memory-alloc" },
  { match: "chunk_dealloc", mechanism: "memory-alloc" },
  { match: "chunk_alloc", mechanism: "memory-alloc" },
  { match: "chunk_recycle", mechanism: "memory-alloc" },
  { match: "idalloc", mechanism: "memory-alloc" },
  { match: "iralloc", mechanism: "memory-alloc" },
  { match: "imalloc", mechanism: "memory-alloc" },
  { match: "icalloc", mechanism: "memory-alloc" },
  { match: "ipalloc", mechanism: "memory-alloc" },
  { match: "huge_dalloc", mechanism: "memory-alloc" },
  { match: "huge_ralloc", mechanism: "memory-alloc" },
  { match: "huge_malloc", mechanism: "memory-alloc" },
  { match: "huge_palloc", mechanism: "memory-alloc" },
  { match: "PageMalloc", mechanism: "memory-alloc" },
  { match: "PageCalloc", mechanism: "memory-alloc" },
  { match: "PageRealloc", mechanism: "memory-alloc" },
  { match: "PageMemalign", mechanism: "memory-alloc" },
  { match: "pod_malloc", mechanism: "memory-alloc" },
  { match: "pod_calloc", mechanism: "memory-alloc" },
  { match: "pod_realloc", mechanism: "memory-alloc" },
  { match: "pod_arena_", mechanism: "memory-alloc" },
  { match: "MallocCharsOnPromotion", mechanism: "memory-alloc" },
  { match: "arena_run_", mechanism: "memory-alloc" },
  { match: "__rust_alloc", mechanism: "memory-alloc" },
  { match: "__rust_realloc", mechanism: "memory-alloc" },
  { match: "__rust_dealloc", mechanism: "memory-alloc" },
  { match: "alloc::raw_vec::", mechanism: "memory-alloc" },
  { match: "PageFree", mechanism: "memory-alloc" },
  { match: "operator new", mechanism: "memory-alloc" },
  { match: "operator delete", mechanism: "memory-alloc" },
  { match: "CallWindowProc", mechanism: "window-message" },
  { match: "DispatchMessage", mechanism: "window-message" },
  { match: "SendMessage", mechanism: "window-message" },
  { match: "PostMessage", mechanism: "window-message" },
  { match: "DefWindowProc", mechanism: "window-message" },
  { match: "UserCallWinProc", mechanism: "window-message" },
  { match: "NtUserMessageCall", mechanism: "window-message" },
  { match: "ZwUserMessageCall", mechanism: "window-message" },
  { match: "TrackPopupMenu", mechanism: "window-message" },
  { match: "PeekMessage", mechanism: "event-loop" },
  { match: "GetMessage", mechanism: "event-loop" },
  { match: "nextEventMatchingMask", mechanism: "event-loop" },
  { match: "CFRunLoopRun", mechanism: "event-loop" },
  { match: "g_main_context_iteration", mechanism: "event-loop" },
  { match: "g_main_context_dispatch", mechanism: "event-loop" },
  { match: "g_poll", mechanism: "event-loop" },

  // -- Activities: Firefox work named by its own frames --
  { match: "WaitForSyncNotify", mechanism: "sync-ipc" },
  { match: "MessageChannel::Send", mechanism: "sync-ipc" },
  { match: "MessageChannel::Call", mechanism: "sync-ipc" },
  { match: "GetRunnableForMTTask", mechanism: "idle-wait" },
  { match: "WinUtils::WaitForMessage", mechanism: "idle-wait" },
  { match: "nsThread::Shutdown", mechanism: "thread-join" },
  { match: "nsThread::AsyncShutdown", mechanism: "thread-join" },
  { match: "nsThreadPool::Shutdown", mechanism: "thread-join" },
  { match: "PR_JoinThread", mechanism: "thread-join" },
  { match: "pthread_join", mechanism: "thread-join" },
  { match: "QuoteJSONString", mechanism: "serialization" },
  { match: "js::Stringify", mechanism: "serialization" },
  { match: "JS_Stringify", mechanism: "serialization" },
  { match: "SerializeJSON", mechanism: "serialization" },
  { match: "EmitSimpleValue", mechanism: "serialization" },
  { match: "EmitQuoted", mechanism: "serialization" },
  { match: "JSONTokenizer", mechanism: "serialization" },
  { match: "JSONFullParseHandler", mechanism: "serialization" },
  { match: "JSONParser", mechanism: "serialization" },
  { match: "JS_ParseJSON", mechanism: "serialization" },
  { match: "js::ParseJSON", mechanism: "serialization" },
  { match: "JSONWriter", mechanism: "serialization" },
  { match: "JSStructuredCloneWriter", mechanism: "serialization" },
  { match: "JSStructuredCloneReader", mechanism: "serialization" },
  { match: "WriteStructuredClone", mechanism: "serialization" },
  { match: "ReadStructuredClone", mechanism: "serialization" },
  { match: "StructuredCloneHolder::Write", mechanism: "serialization" },
  { match: "StructuredCloneHolder::Read", mechanism: "serialization" },
  { match: "js::frontend::", mechanism: "script-compile" },
  { match: "JS::Compile", mechanism: "script-compile" },
  { match: "JS::DecodeStencil", mechanism: "script-compile" },
  { match: "js::DecodeStencil", mechanism: "script-compile" },
  { match: "Stencil::", mechanism: "script-compile" },
  { match: "js::jit::IonCompile", mechanism: "script-compile" },
  { match: "js::jit::BaselineCompile", mechanism: "script-compile" },

  // -- Phases: anything below them is part of the collection --
  { match: "js::gc::", mechanism: "gc" },
  { match: "GCRuntime::", mechanism: "gc" },
  { match: "js::Nursery::", mechanism: "gc" },
  { match: "js::GCMarker", mechanism: "gc" },
  { match: "js::TenuringTracer", mechanism: "gc" },
  { match: "JS::GCCellPtr", mechanism: "gc" },
  { match: "nsCycleCollector", mechanism: "cc" },
  { match: "SnowWhiteKiller", mechanism: "cc" },
  { match: "IncrementalFinalizeRunnable", mechanism: "cc" },
  { match: "FinalizeDeferredThings", mechanism: "cc" },
  { match: "DeferredFinalize", mechanism: "cc" },
  { match: "CycleCollectedJSRuntime::", mechanism: "cc" },
];

/**
 * How far from the leaf an activity is looked for, counting only frames that
 * do something: lock and allocator internals and glue don't count, so a
 * ten-frame realloc chain under `JSON.stringify` doesn't hide it.
 */
const ACTIVITY_DEPTH = 16;

// -- Areas --------------------------------------------------------------------

export const AREAS = {
  "session-restore": "Session restore",
  places: "Bookmarks & history",
  "address-bar": "Address bar",
  tabs: "Tabs",
  "new-tab": "New tab page",
  profiles: "Profiles",
  passwords: "Passwords & key storage",
  "form-autofill": "Form autofill",
  extensions: "Extensions & add-ons",
  devtools: "DevTools",
  downloads: "Downloads",
  updates: "Application update",
  telemetry: "Telemetry",
  memory: "Memory management",
  messaging: "Messaging system",
  migration: "Profile migration",
  shell: "OS shell & taskbar",
  "crash-reporting": "Crash reporting",
  printing: "Printing",
  permissions: "Geolocation & permissions",
  media: "Media & WebRTC",
  clipboard: "Clipboard & drag-and-drop",
  "file-picker": "File picker & dialogs",
  "text-input": "Text input (IME)",
  accessibility: "Accessibility",
  fonts: "Fonts & text",
  "startup-cache": "Startup cache",
  "module-loading": "JS module loading",
  omnijar: "Omnijar & resources",
  navigation: "Navigation & page load",
  networking: "Networking",
  security: "Security & certificates",
  storage: "Storage (SQLite, IndexedDB)",
  preferences: "Preferences",
  images: "Images",
  apz: "Scrolling & zooming (APZ)",
  graphics: "Graphics & compositing",
  layout: "Layout & painting",
  style: "Style (CSS)",
  events: "Events & input",
  "js-actors": "JS actors (IPC)",
  processes: "Child processes",
  "js-engine": "JavaScript engine",
  "cycle-collector": "Cycle collector",
  windowing: "Windows & widgets",
  dom: "DOM",
  files: "File APIs (IOUtils, nsIFile)",
  "front-end": "Front-end JavaScript",
} as const;

export type AreaId = keyof typeof AREAS;

type Weight = 1 | 2 | 3;

interface AreaRule {
  match: string;
  lib?: boolean;
  area: AreaId;
  /**
   * 3 names a feature or subsystem outright, 2 a broad but real area, 1 an API
   * layer or generic namespace that only answers when nothing better is on the
   * stack (`mozilla::dom::` alone says little; `nsLocalFile` is whoever called
   * it).
   */
  weight: Weight;
}

/**
 * Ordered so a frame's most specific rule comes first: the first rule that
 * matches a frame decides it.
 */
const AREA_RULES: AreaRule[] = [
  // -- Features, mostly named by their JS modules --
  { match: "SessionStore", area: "session-restore", weight: 3 },
  { match: "SessionWriter", area: "session-restore", weight: 3 },
  { match: "SessionFile", area: "session-restore", weight: 3 },
  { match: "sessionstore/", area: "session-restore", weight: 3 },
  { match: "places::", area: "places", weight: 3 },
  { match: "nsNavHistory", area: "places", weight: 3 },
  { match: "nsNavBookmarks", area: "places", weight: 3 },
  { match: "nsFaviconService", area: "places", weight: 3 },
  { match: "PlacesUtils", area: "places", weight: 3 },
  { match: "PlacesDBUtils", area: "places", weight: 3 },
  { match: "PlacesTransactions", area: "places", weight: 3 },
  { match: "Bookmarks.sys.mjs", area: "places", weight: 3 },
  { match: "History.sys.mjs", area: "places", weight: 3 },
  { match: "places/", area: "places", weight: 3 },
  { match: "Urlbar", area: "address-bar", weight: 3 },
  { match: "urlbar/", area: "address-bar", weight: 3 },
  { match: "tabbrowser", area: "tabs", weight: 3 },
  { match: "AsyncTabSwitcher", area: "tabs", weight: 3 },
  { match: "TabsList", area: "tabs", weight: 3 },
  { match: "newtab/", area: "new-tab", weight: 3 },
  { match: "AboutNewTab", area: "new-tab", weight: 3 },
  { match: "activity-stream", area: "new-tab", weight: 3 },
  { match: "SelectableProfile", area: "profiles", weight: 3 },
  { match: "ProfilesDatastore", area: "profiles", weight: 3 },
  { match: "nsToolkitProfile", area: "profiles", weight: 3 },
  { match: "profiles/", area: "profiles", weight: 3 },
  { match: "LoginManager", area: "passwords", weight: 3 },
  { match: "LoginHelper", area: "passwords", weight: 3 },
  { match: "LoginStore", area: "passwords", weight: 3 },
  { match: "passwordmgr", area: "passwords", weight: 3 },
  { match: "OSKeyStore", area: "passwords", weight: 3 },
  { match: "PK11SDR_", area: "passwords", weight: 3 },
  { match: "nsSecretDecoderRing", area: "passwords", weight: 3 },
  { match: "crypto-SDR", area: "passwords", weight: 3 },
  { match: "FormAutofill", area: "form-autofill", weight: 3 },
  { match: "formautofill/", area: "form-autofill", weight: 3 },
  { match: "ExtensionParent", area: "extensions", weight: 3 },
  { match: "ExtensionCommon", area: "extensions", weight: 3 },
  { match: "ExtensionChild", area: "extensions", weight: 3 },
  { match: "ExtensionPolicy", area: "extensions", weight: 3 },
  { match: "WebExtension", area: "extensions", weight: 3 },
  { match: "extensions/", area: "extensions", weight: 3 },
  { match: "moz-extension://", area: "extensions", weight: 3 },
  { match: "AddonManager", area: "extensions", weight: 3 },
  { match: "XPIProvider", area: "extensions", weight: 3 },
  { match: "XPIDatabase", area: "extensions", weight: 3 },
  { match: "devtools/", area: "devtools", weight: 3 },
  { match: "Downloads.sys.mjs", area: "downloads", weight: 3 },
  { match: "DownloadIntegration", area: "downloads", weight: 3 },
  { match: "DownloadCore", area: "downloads", weight: 3 },
  { match: "DownloadPlatform", area: "downloads", weight: 3 },
  { match: "nsExternalHelperAppService", area: "downloads", weight: 3 },
  { match: "nsExternalAppHandler", area: "downloads", weight: 3 },
  { match: "UpdateService", area: "updates", weight: 3 },
  { match: "nsUpdateDriver", area: "updates", weight: 3 },
  { match: "UpdateUtils", area: "updates", weight: 3 },
  { match: "AppUpdater", area: "updates", weight: 3 },
  { match: "BHRTelemetryService", area: "telemetry", weight: 3 },
  { match: "TelemetryController", area: "telemetry", weight: 3 },
  { match: "TelemetrySession", area: "telemetry", weight: 3 },
  { match: "MemoryTelemetry", area: "telemetry", weight: 3 },
  { match: "mozilla::Telemetry", area: "telemetry", weight: 3 },
  { match: "mozilla::glean::", area: "telemetry", weight: 3 },
  { match: "glean::", area: "telemetry", weight: 3 },
  { match: "telemetry/", area: "telemetry", weight: 3 },
  { match: "TelemetryStartup", area: "telemetry", weight: 3 },
  { match: "RunIdleMemoryCleanup", area: "memory", weight: 3 },
  { match: "moz_may_purge", area: "memory", weight: 3 },
  { match: "nsMemoryReporterManager", area: "memory", weight: 3 },
  { match: "MemoryPressure", area: "memory", weight: 3 },
  { match: "ASRouter", area: "messaging", weight: 3 },
  { match: "asrouter/", area: "messaging", weight: 3 },
  { match: "MigrationUtils", area: "migration", weight: 3 },
  { match: "MigratorBase", area: "migration", weight: 3 },
  { match: "migration/", area: "migration", weight: 3 },
  { match: "Taskbar", area: "shell", weight: 3 },
  { match: "JumpList", area: "shell", weight: 3 },
  { match: "FaviconHelper", area: "shell", weight: 3 },
  { match: "ShellService", area: "shell", weight: 3 },
  { match: "WindowsUIUtils", area: "shell", weight: 3 },
  { match: "Windows::UI::Shell", area: "shell", weight: 3 },
  { match: "ExplorerFrame", lib: true, area: "shell", weight: 3 },
  { match: "wpnapps", lib: true, area: "shell", weight: 3 },
  { match: "CrashReporter", area: "crash-reporting", weight: 3 },
  { match: "crashreporter", area: "crash-reporting", weight: 3 },
  { match: "CrashMonitor", area: "crash-reporting", weight: 3 },
  { match: "nsPrint", area: "printing", weight: 3 },
  { match: "PrintTarget", area: "printing", weight: 3 },
  { match: "nsDeviceContextSpec", area: "printing", weight: 3 },
  { match: "printing/", area: "printing", weight: 3 },
  { match: "geolocation", area: "permissions", weight: 3 },
  { match: "Geolocation", area: "permissions", weight: 3 },
  { match: "PermissionManager", area: "permissions", weight: 3 },
  { match: "AppCapability", area: "permissions", weight: 3 },
  { match: "CapabilityAccessManager", lib: true, area: "permissions", weight: 3 },
  { match: "MediaManager", area: "media", weight: 3 },
  { match: "MediaDecoder", area: "media", weight: 3 },
  { match: "HTMLMediaElement", area: "media", weight: 3 },
  { match: "AudioStream", area: "media", weight: 3 },
  { match: "cubeb", area: "media", weight: 3 },
  { match: "WMFDecoder", area: "media", weight: 3 },
  { match: "PWebrtcGlobal", area: "media", weight: 3 },
  { match: "webrtc::", area: "media", weight: 3 },
  { match: "WebrtcGlobal", area: "media", weight: 3 },
  { match: "mfplat", lib: true, area: "media", weight: 3 },
  { match: "nsClipboard", area: "clipboard", weight: 3 },
  { match: "nsBaseClipboard", area: "clipboard", weight: 3 },
  { match: "nsDataObj", area: "clipboard", weight: 3 },
  { match: "nsDragService", area: "clipboard", weight: 3 },
  { match: "CClipDataObject", area: "clipboard", weight: 3 },
  { match: "OleGetClipboard", area: "clipboard", weight: 3 },
  { match: "NSPasteboard", area: "clipboard", weight: 3 },
  { match: "nsFilePicker", area: "file-picker", weight: 3 },
  { match: "IFileDialog", area: "file-picker", weight: 3 },
  { match: "comdlg32", lib: true, area: "file-picker", weight: 3 },
  { match: "TSFTextStore", area: "text-input", weight: 3 },
  { match: "IMEHandler", area: "text-input", weight: 3 },
  { match: "IMMHandler", area: "text-input", weight: 3 },
  { match: "TSFUtils", area: "text-input", weight: 3 },
  { match: "CInputPaneEventSource", area: "text-input", weight: 3 },
  { match: "msctf", lib: true, area: "text-input", weight: 3 },
  { match: "TextInputFramework", lib: true, area: "text-input", weight: 3 },
  { match: "imm32", lib: true, area: "text-input", weight: 3 },
  { match: "mozilla::a11y::", area: "accessibility", weight: 3 },
  { match: "AccessibleWrap", area: "accessibility", weight: 3 },
  { match: "MsaaAccessible", area: "accessibility", weight: 3 },
  { match: "uiaRawElmProvider", area: "accessibility", weight: 3 },
  { match: "get_acc", area: "accessibility", weight: 3 },
  { match: "UIAutomationCore", lib: true, area: "accessibility", weight: 3 },
  { match: "oleacc", lib: true, area: "accessibility", weight: 3 },
  { match: "libatk", lib: true, area: "accessibility", weight: 3 },
  { match: "gfxDWriteFont", area: "fonts", weight: 3 },
  { match: "gfxPlatformFontList", area: "fonts", weight: 3 },
  { match: "gfxFont", area: "fonts", weight: 3 },
  { match: "gfxTextRun", area: "fonts", weight: 3 },
  { match: "gfxFT2", area: "fonts", weight: 3 },
  { match: "gfxFcPlatformFontList", area: "fonts", weight: 3 },
  { match: "gfxMacPlatformFontList", area: "fonts", weight: 3 },
  { match: "CoreTextFontList", area: "fonts", weight: 3 },
  { match: "fontlist::", area: "fonts", weight: 3 },
  { match: "FontFaceSet", area: "fonts", weight: 3 },
  { match: "gfxUserFontSet", area: "fonts", weight: 3 },
  { match: "LoadCmapsRunnable", area: "fonts", weight: 3 },
  { match: "FT_", area: "fonts", weight: 3 },
  { match: "DWrite", lib: true, area: "fonts", weight: 3 },
  { match: "libfreetype", lib: true, area: "fonts", weight: 3 },
  { match: "libfontconfig", lib: true, area: "fonts", weight: 3 },
  { match: "CoreText", lib: true, area: "fonts", weight: 3 },
  { match: "StartupCache", area: "startup-cache", weight: 3 },
  { match: "scache::", area: "startup-cache", weight: 3 },
  { match: "ScriptPreloader", area: "startup-cache", weight: 3 },
  { match: "URLPreloader", area: "startup-cache", weight: 3 },
  { match: "nsZipArchive", area: "omnijar", weight: 3 },
  { match: "nsZipHandle", area: "omnijar", weight: 3 },
  { match: "nsZipReaderCache", area: "omnijar", weight: 3 },
  { match: "nsJARChannel", area: "omnijar", weight: 3 },
  { match: "nsJAR::", area: "omnijar", weight: 3 },
  { match: "Omnijar", area: "omnijar", weight: 3 },
  { match: "nsDocShell", area: "navigation", weight: 3 },
  { match: "nsDocLoader", area: "navigation", weight: 3 },
  { match: "nsURILoader", area: "navigation", weight: 3 },
  { match: "nsDocumentOpenInfo", area: "navigation", weight: 3 },
  { match: "DocumentLoadListener", area: "navigation", weight: 3 },
  { match: "BrowsingContext::LoadURI", area: "navigation", weight: 3 },
  { match: "BrowsingContext::Navigate", area: "navigation", weight: 3 },
  { match: "BrowsingContext::FixupAndLoadURIString", area: "navigation", weight: 3 },
  { match: "nsSHistory", area: "navigation", weight: 3 },
  { match: "SessionHistoryEntry", area: "navigation", weight: 3 },
  { match: "BrowserParent::LoadURL", area: "navigation", weight: 3 },
  { match: "nsDocShellLoadState", area: "navigation", weight: 3 },
  { match: "mozilla::psm::", area: "security", weight: 3 },
  { match: "nsNSSComponent", area: "security", weight: 3 },
  { match: "nsNSSCertificate", area: "security", weight: 3 },
  { match: "SSLServerCertVerification", area: "security", weight: 3 },
  { match: "cert_storage", area: "security", weight: 3 },
  { match: "Preferences::", area: "preferences", weight: 3 },
  { match: "nsPrefBranch", area: "preferences", weight: 3 },
  { match: "PreferencesWriter", area: "preferences", weight: 3 },
  { match: "PAPZ", area: "apz", weight: 3 },
  { match: "APZInputBridge", area: "apz", weight: 3 },
  { match: "APZCTreeManager", area: "apz", weight: 3 },
  { match: "AsyncPanZoom", area: "apz", weight: 3 },
  { match: "mozilla::layers::APZ", area: "apz", weight: 3 },
  { match: "LaunchSubprocess", area: "processes", weight: 3 },
  { match: "GeckoChildProcessHost", area: "processes", weight: 3 },
  { match: "PreallocatedProcessManager", area: "processes", weight: 3 },
  { match: "GetNewOrUsedBrowserProcess", area: "processes", weight: 3 },

  // -- Broad areas --
  { match: "mozJSModuleLoader", area: "module-loading", weight: 2 },
  { match: "SyncModuleLoader", area: "module-loading", weight: 2 },
  { match: "ModuleLoaderBase", area: "module-loading", weight: 2 },
  { match: "ModuleLoadRequest", area: "module-loading", weight: 2 },
  { match: "ImportESModule", area: "module-loading", weight: 2 },
  { match: "ESModuleGetter", area: "module-loading", weight: 2 },
  { match: "mozilla::loader::", area: "module-loading", weight: 2 },
  { match: "mozilla::net::", area: "networking", weight: 2 },
  { match: "nsHttp", area: "networking", weight: 2 },
  { match: "nsSocketTransport", area: "networking", weight: 2 },
  { match: "nsIOService", area: "networking", weight: 2 },
  { match: "nsStandardURL", area: "networking", weight: 2 },
  { match: "nsDNSService", area: "networking", weight: 2 },
  { match: "nsHostResolver", area: "networking", weight: 2 },
  { match: "nsProtocolProxyService", area: "networking", weight: 2 },
  { match: "nsCookie", area: "networking", weight: 2 },
  { match: "CookieService", area: "networking", weight: 2 },
  { match: "nsFileChannel", area: "networking", weight: 2 },
  { match: "winhttp", lib: true, area: "networking", weight: 2 },
  { match: "PK11_", area: "security", weight: 2 },
  { match: "CERT_", area: "security", weight: 2 },
  { match: "SEC_", area: "security", weight: 2 },
  { match: "NSS_", area: "security", weight: 2 },
  { match: "NSC_", area: "security", weight: 2 },
  { match: "sftk", area: "security", weight: 2 },
  { match: "softokn3", lib: true, area: "security", weight: 2 },
  { match: "freebl3", lib: true, area: "security", weight: 2 },
  { match: "nssckbi", lib: true, area: "security", weight: 2 },
  { match: "mozStorage", area: "storage", weight: 2 },
  { match: "mozilla::storage::", area: "storage", weight: 2 },
  { match: "sqlite3", area: "storage", weight: 2 },
  { match: "indexedDB", area: "storage", weight: 2 },
  { match: "mozilla::dom::quota::", area: "storage", weight: 2 },
  { match: "LSObject", area: "storage", weight: 2 },
  { match: "kvstore", area: "storage", weight: 2 },
  { match: "mozilla::image::", area: "images", weight: 2 },
  { match: "imgLoader", area: "images", weight: 2 },
  { match: "imgRequest", area: "images", weight: 2 },
  { match: "imgFrame", area: "images", weight: 2 },
  { match: "WindowsCodecs", lib: true, area: "images", weight: 2 },
  { match: "mozilla::wr::", area: "graphics", weight: 2 },
  { match: "WebRender", area: "graphics", weight: 2 },
  { match: "mozilla::layers::", area: "graphics", weight: 2 },
  { match: "mozilla::gfx::", area: "graphics", weight: 2 },
  { match: "gfxPlatform", area: "graphics", weight: 2 },
  { match: "SanityTest", area: "graphics", weight: 2 },
  { match: "gfxWindowsPlatform", area: "graphics", weight: 2 },
  { match: "gfxContext", area: "graphics", weight: 2 },
  { match: "DeviceManagerDx", area: "graphics", weight: 2 },
  { match: "CanvasRenderingContext2D", area: "graphics", weight: 2 },
  { match: "WebGLContext", area: "graphics", weight: 2 },
  { match: "nsCSSFrameConstructor", area: "layout", weight: 2 },
  { match: "PresShell", area: "layout", weight: 2 },
  { match: "nsIFrame", area: "layout", weight: 2 },
  { match: "nsLayoutUtils", area: "layout", weight: 2 },
  { match: "ReflowInput", area: "layout", weight: 2 },
  { match: "nsBlockFrame", area: "layout", weight: 2 },
  { match: "nsFlexContainerFrame", area: "layout", weight: 2 },
  { match: "nsGridContainerFrame", area: "layout", weight: 2 },
  { match: "nsTable", area: "layout", weight: 2 },
  { match: "ScrollContainerFrame", area: "layout", weight: 2 },
  { match: "nsContainerFrame", area: "layout", weight: 2 },
  { match: "nsTextFrame", area: "layout", weight: 2 },
  { match: "nsLineLayout", area: "layout", weight: 2 },
  { match: "nsFrameList", area: "layout", weight: 2 },
  { match: "nsDisplayList", area: "layout", weight: 2 },
  { match: "nsRefreshDriver", area: "layout", weight: 2 },
  { match: "AnchorPos", area: "layout", weight: 2 },
  { match: "Servo_", area: "style", weight: 2 },
  { match: "style::", area: "style", weight: 2 },
  { match: "servo_arc", area: "style", weight: 2 },
  { match: "ServoStyleSet", area: "style", weight: 2 },
  { match: "ServoComputedData", area: "style", weight: 2 },
  { match: "RestyleManager", area: "style", weight: 2 },
  { match: "ComputedStyle", area: "style", weight: 2 },
  { match: "nsStyle", area: "style", weight: 2 },
  { match: "nsCSS", area: "style", weight: 2 },
  { match: "StyleSheet", area: "style", weight: 2 },
  { match: "EventListenerManager", area: "events", weight: 2 },
  { match: "EventDispatcher", area: "events", weight: 2 },
  { match: "DispatchInputEvent", area: "events", weight: 2 },
  { match: "DispatchMouseEvent", area: "events", weight: 2 },
  { match: "DispatchKeyboardEvent", area: "events", weight: 2 },
  { match: "JSActor", area: "js-actors", weight: 2 },
  { match: "JSWindowActor", area: "js-actors", weight: 2 },
  { match: "JSProcessActor", area: "js-actors", weight: 2 },
  { match: "WindowGlobalParent::RecvRawMessage", area: "js-actors", weight: 2 },
  { match: "js::gc::", area: "js-engine", weight: 2 },
  { match: "GCRuntime::", area: "js-engine", weight: 2 },
  { match: "js::Nursery::", area: "js-engine", weight: 2 },
  { match: "js::frontend::", area: "js-engine", weight: 2 },
  { match: "nsCycleCollector", area: "cycle-collector", weight: 2 },
  { match: "FinalizeDeferredThings", area: "cycle-collector", weight: 2 },
  { match: "DeferredFinalize", area: "cycle-collector", weight: 2 },
  { match: "SnowWhiteKiller", area: "cycle-collector", weight: 2 },
  { match: "IncrementalFinalizeRunnable", area: "cycle-collector", weight: 2 },
  { match: "AppWindow::", area: "windowing", weight: 2 },
  { match: "nsWindowWatcher", area: "windowing", weight: 2 },
  { match: "nsChromeTreeOwner", area: "windowing", weight: 2 },
  { match: "mozilla::IOUtils", area: "files", weight: 2 },
  { match: "browser/content/", area: "front-end", weight: 2 },
  { match: "browser/modules/", area: "front-end", weight: 2 },
  { match: "browser/components/", area: "front-end", weight: 2 },

  // -- API layers and generic namespaces: only when nothing better --
  { match: "nss3", lib: true, area: "security", weight: 1 },
  { match: "nsWindow::", area: "windowing", weight: 1 },
  { match: "nsCocoaWindow", area: "windowing", weight: 1 },
  { match: "nsChildView", area: "windowing", weight: 1 },
  { match: "nsIWidget", area: "windowing", weight: 1 },
  { match: "mozilla::widget::", area: "windowing", weight: 1 },
  { match: "gtk_", area: "windowing", weight: 1 },
  { match: "libgtk", lib: true, area: "windowing", weight: 1 },
  { match: "libgdk", lib: true, area: "windowing", weight: 1 },
  { match: "libX11", lib: true, area: "windowing", weight: 1 },
  { match: "AppKit", lib: true, area: "windowing", weight: 1 },
  { match: "HIToolbox", lib: true, area: "windowing", weight: 1 },
  { match: "SkyLight", lib: true, area: "windowing", weight: 1 },
  { match: "Microsoft.UI", lib: true, area: "windowing", weight: 1 },
  { match: "nsLocalFile", area: "files", weight: 1 },
  { match: "do_mkdir", area: "files", weight: 1 },
  { match: "mozilla::dom::", area: "dom", weight: 1 },
  { match: "nsGlobalWindow", area: "dom", weight: 1 },
  { match: "nsContentUtils", area: "dom", weight: 1 },
  { match: "nsINode", area: "dom", weight: 1 },
  { match: "gre/modules/", area: "front-end", weight: 1 },
  { match: "global/content/", area: "front-end", weight: 1 },
  { match: "/actors/", area: "front-end", weight: 1 },
  { match: ".sys.mjs", area: "front-end", weight: 1 },
  { match: "chrome://", area: "front-end", weight: 1 },
  { match: "resource://", area: "front-end", weight: 1 },
];

/**
 * Frames that say nothing about where a hang belongs: binding and XPConnect
 * glue, the JS engine's call machinery, the event loop, DLL interceptors, smart
 * pointers and string/container boilerplate. Skipped when looking for an area
 * or the caller, so the answer is the code doing the work rather than the code
 * that passed the call along.
 */
const PLUMBING = [
  "_Binding::",
  "binding_detail::",
  "lazy_getter",
  "Callback::Call",
  "StaticMethodPromiseWrapper",
  "XPTC__",
  "CallMethodHelper",
  "XPCWrappedNative",
  "XPC_WN_",
  "nsXPCWrappedJS",
  "PrepareAndDispatch",
  "CallJSNative",
  "InternalCall",
  "js::Call",
  "js::Interpret",
  "js::RunScript",
  "js::fun_",
  "js::BoundFunctionObject",
  "js::Activation",
  "js::jit::JitActivation",
  "js::jit::MaybeEnterJit",
  "js::jit::InterpretResume",
  "MaybeEnterInterpreterTrampoline",
  "EnterJit",
  "JS_CallFunction",
  "JS::Call",
  "InterpretGeneratorResume",
  "self-hosted:",
  "interceptor::",
  "Interposed",
  "TaskController",
  "RunnableTask",
  "Runnable::Run",
  "RunnableFunction",
  "RunnableMethod",
  "IdleRunnableWrapper",
  "nsThread::",
  "NS_ProcessNextEvent",
  "nsBaseAppShell",
  "nsAppShell::",
  "MessageLoop",
  "MessagePump",
  "SpinEventLoopUntil",
  "MicroTask",
  "PromiseJob",
  "AfterProcessTask",
  "AutoProfiler",
  "ProfilerLabel",
  "MaybeStorage<",
  "MessageChannel::",
  "MessageLink",
  "IProtocol::",
  "XREMain",
  "XRE_main",
  "RefPtr<",
  "nsCOMPtr<",
  "already_AddRefed<",
  "mozilla::detail::",
  "std::",
  "nsTSubstring",
  "nsTString",
  "nsTDependentString",
  "nsTLiteralString",
  "nsCharTraits",
  "nsTArray",
  "mozilla::Span<",
  "mozilla::RangedPtr<",
  "mozilla::Maybe<",
  "mozilla::UniquePtr<",
  "mozilla::Vector<",
  "mozilla::ArrayIterator<",
  "mozilla::SegmentedVector<",
  "mozilla::HashTable",
  "PLDHashTable",
  "nsTHashtable",
  "LinkedListElement<",
  "JS::Rooted<",
  "JS::Handle<",
  "JS::MutableHandle<",
];

/**
 * Frame names that carry no symbol. `(unresolved)` on top of a JIT activation
 * is JIT-compiled JavaScript. An `<unsymbolicated>` frame that still names its
 * library is not a sentinel: the library says where the thread was.
 */
function isSentinel(name: string, lib: string): boolean {
  return (
    !name.trim() ||
    name === "(unresolved)" ||
    name === "(root)" ||
    (name.startsWith("<unsymbolicated>") && !lib)
  );
}

/**
 * Libraries Mozilla ships. Code in them counts as Firefox work, unlike the OS
 * libraries a hang so often stops in.
 */
const MOZILLA_LIBS = new Set([
  "",
  "xul",
  "XUL",
  "xul.dll",
  "libxul.so",
  "mozglue",
  "libmozglue.so",
  "libmozglue.dylib",
  "firefox",
  "firefox-bin",
  "firefox.exe",
  "plugin-container",
  "nss3",
  "libnss3.so",
  "libnss3.dylib",
  "softokn3",
  "libsoftokn3.so",
  "libsoftokn3.dylib",
  "freebl3",
  "lgpllibs",
  "mozavcodec",
  "mozavutil",
]);

/** A symbol without its argument list, which names types it merely uses. */
function symbolOf(funcName: string): string {
  const name = funcName.replaceAll("(anonymous namespace)::", "");
  const paren = name.indexOf("(");
  return paren <= 0 ? name : name.slice(0, paren);
}

/** A JS frame names its file: "handleEvent /modules/Foo.sys.mjs:756". */
function isJsFrame(name: string, lib: string): boolean {
  return lib === "" && /\S+:\d+$/.test(name);
}

/** The JS engine, and the microtask checkpoint that runs promise callbacks. */
const JS_ENGINE = /^(js::|JS::|JS_|js_)|MicroTask|PromiseJob/;

// -- Per-function table -------------------------------------------------------

const FLAG_PLUMBING = 1;
/** Code Mozilla ships: Firefox work rather than an OS library. */
const FLAG_MOZILLA = 2;
const FLAG_SENTINEL = 4;
const FLAG_JS_ENGINE = 8;
/** A JavaScript frame (has a file and line). */
const FLAG_JS = 16;

/**
 * Every function's rule matches, worked out once. Indexed by funcTable index;
 * -1 means no rule matched. Plain typed arrays so the worker can hand it to the
 * main thread cheaply, where group members and diffs are classified.
 */
export interface FrameTable {
  mechanism: Int16Array;
  area: Int16Array;
  flags: Uint8Array;
}

/**
 * Both rule lists compiled for matching: whole-symbol rules in maps, and the
 * substring rules indexed by their first three characters. A name is then
 * scanned once, with one map lookup per position, rather than tested against
 * each of several hundred rules; that matters with ~150k functions on a
 * production day.
 */
interface RuleIndex {
  mechanismExact: Map<string, number>;
  areaExact: Map<string, number>;
  /**
   * Prefix -> candidate rules, mechanism rules as their index and area rules
   * as AREA_BASE + index, in ascending order.
   */
  byPrefix: Map<number, number[]>;
}

const PREFIX = 3;
const AREA_BASE = 0x10000;

/**
 * Three characters packed into a small integer (so the map can hash it
 * cheaply). Characters past U+03FF can collide, which only costs a
 * `startsWith` check that fails.
 */
function prefixKey(text: string, at: number): number {
  return (
    ((text.charCodeAt(at) & 0x3ff) << 20) |
    ((text.charCodeAt(at + 1) & 0x3ff) << 10) |
    (text.charCodeAt(at + 2) & 0x3ff)
  );
}

function buildRuleIndex(): RuleIndex {
  const byPrefix = new Map<number, number[]>();
  const add = (rules: { match: string; exact?: boolean }[], base: number) => {
    const exact = new Map<string, number>();
    rules.forEach((rule, i) => {
      if (rule.exact) {
        if (!exact.has(rule.match)) {
          exact.set(rule.match, i);
        }
        return;
      }
      if (rule.match.length < PREFIX) {
        throw new Error(`Rule "${rule.match}" is too short to index`);
      }
      const key = prefixKey(rule.match, 0);
      const list = byPrefix.get(key);
      if (list) {
        list.push(base + i);
      } else {
        byPrefix.set(key, [base + i]);
      }
    });
    return exact;
  };
  const mechanismExact = add(MECHANISM_RULES, 0);
  const areaExact = add(AREA_RULES, AREA_BASE);
  return { mechanismExact, areaExact, byPrefix };
}

const RULE_INDEX = buildRuleIndex();

/**
 * The first mechanism rule and first area rule matching a frame, as indices
 * into their lists (-1 for none). Area rules see `areaText`, which for a JS
 * frame includes the file path.
 */
function matchFrame(symbol: string, areaText: string, lib: string): [number, number] {
  const { mechanismExact, areaExact, byPrefix } = RULE_INDEX;
  let mech = mechanismExact.get(symbol) ?? MECHANISM_RULES.length;
  let area = areaExact.get(symbol) ?? AREA_RULES.length;
  const scan = (text: string, isLib: boolean, mechanisms: boolean, areas: boolean) => {
    for (let at = 0; at + PREFIX <= text.length; at++) {
      const candidates = byPrefix.get(prefixKey(text, at));
      if (!candidates) {
        continue;
      }
      for (const c of candidates) {
        const isArea = c >= AREA_BASE;
        const i = isArea ? c - AREA_BASE : c;
        if (isArea ? !areas || i >= area : !mechanisms || i >= mech) {
          continue;
        }
        const rule = isArea ? AREA_RULES[i] : MECHANISM_RULES[i];
        if (!!rule.lib === isLib && text.startsWith(rule.match, at)) {
          if (isArea) {
            area = i;
          } else {
            mech = i;
          }
        }
      }
    }
  };
  if (areaText === symbol) {
    scan(symbol, false, true, true);
  } else {
    scan(symbol, false, true, false);
    scan(areaText, false, false, true);
  }
  if (lib) {
    scan(lib, true, true, true);
  }
  return [mech < MECHANISM_RULES.length ? mech : -1, area < AREA_RULES.length ? area : -1];
}

const PLUMBING_RE = new RegExp(
  PLUMBING.map((s) => s.replace(/[[\]{}()*+?.\\^$|/]/g, "\\$&")).join("|"),
);

export function buildFrameTable(funcNames: string[], libNames: string[]): FrameTable {
  const n = funcNames.length;
  const mechanism = new Int16Array(n);
  const area = new Int16Array(n);
  const flags = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    const name = funcNames[f] ?? "";
    const lib = libNames[f] ?? "";
    if (isSentinel(name, lib)) {
      mechanism[f] = -1;
      area[f] = -1;
      flags[f] = FLAG_SENTINEL | FLAG_PLUMBING;
      continue;
    }
    const symbol = symbolOf(name);
    let flag = 0;
    if (MOZILLA_LIBS.has(lib)) {
      flag |= FLAG_MOZILLA;
    }
    if (isJsFrame(name, lib)) {
      flag |= FLAG_JS;
    }
    if (JS_ENGINE.test(symbol)) {
      flag |= FLAG_JS_ENGINE;
    }
    if (PLUMBING_RE.test(symbol)) {
      flag |= FLAG_PLUMBING;
    }
    // JS frames carry their file path; match the whole name so the path counts.
    [mechanism[f], area[f]] = matchFrame(symbol, flag & FLAG_JS ? name : symbol, lib);
    flags[f] = flag;
  }
  return { mechanism, area, flags };
}

// -- Classifying a stack ------------------------------------------------------

export interface HangKind {
  mechanism: MechanismId;
  /** Stack depth (0 = leaf) of the frame that decided the mechanism, or -1. */
  mechanismFrame: number;
  /** For file I/O, the operation: "open", "delete", "metadata", ... */
  operation?: string;
  /** For a system library call, the library: "ExplorerFrame", "DWrite". */
  library?: string;
  /** Innermost area named on the stack, or null when nothing names one. */
  area: AreaId | null;
  areaFrame: number;
  /** The next different area further out: what the browser was doing. */
  activity: AreaId | null;
  activityFrame: number;
  /**
   * The first distinctive Firefox frame above the mechanism: the code that
   * made the blocking call, or that was running. -1 when there is none.
   */
  callerFrame: number;
}

/** Classify a stack (funcTable indices, leaf -> root). */
export function classifyStack(
  frameKeys: ArrayLike<number>,
  table: FrameTable,
  libNames: string[],
): HangKind {
  const { mechanism: mechRule, flags } = table;
  const n = frameKeys.length;

  // Mechanism. The boundary is the innermost system call or primitive, as long
  // as no Firefox work sits below it; the activity is Firefox work named by its
  // frames near the leaf; a phase (GC/CC) counts at any depth.
  let boundary = -1;
  let activity = -1;
  let phase = -1;
  let firstWork = -1;
  let firstSystem = -1;
  let distance = 0;
  for (let d = 0; d < n; d++) {
    const f = frameKeys[d];
    const rule = mechRule[f];
    const flag = flags[f];
    const info = rule >= 0 ? MECHANISMS[MECHANISM_RULES[rule].mechanism] : null;
    if (!info?.family && !(flag & (FLAG_PLUMBING | FLAG_SENTINEL))) {
      distance++;
    }
    if (info) {
      if (info.kind === "boundary" && boundary < 0 && firstWork < 0) {
        boundary = d;
      } else if (info.kind === "activity" && activity < 0 && distance <= ACTIVITY_DEPTH) {
        activity = d;
      } else if (info.kind === "phase" && phase < 0) {
        phase = d;
      }
    }
    if (firstWork < 0 && !info) {
      if (!(flag & (FLAG_MOZILLA | FLAG_JS | FLAG_SENTINEL))) {
        // An OS library frame no rule knows: where the thread was, if nothing
        // more specific turns up.
        if (firstSystem < 0) {
          firstSystem = d;
        }
      } else if (!(flag & FLAG_SENTINEL) && !(flag & FLAG_PLUMBING && !(flag & FLAG_JS_ENGINE))) {
        // The first Firefox frame doing real work (not glue, not a rule
        // match) ends the search for a boundary: anything below it is its.
        firstWork = d;
      }
    }
    if (phase >= 0 && activity >= 0 && (boundary >= 0 || firstWork >= 0)) {
      break;
    }
  }

  const ruleAt = (d: number) => MECHANISM_RULES[mechRule[frameKeys[d]]];
  const explains = (d: number, family: Family | undefined) =>
    d >= 0 && !!family && !!MECHANISMS[ruleAt(d).mechanism].explains?.includes(family);

  let decided = -1;
  if (boundary >= 0) {
    const info = MECHANISMS[ruleAt(boundary).mechanism];
    if (info.strong) {
      decided = boundary;
    } else if (info.family) {
      // A primitive: a nearby activity, or a collection in progress, explains it.
      decided = explains(activity, info.family)
        ? activity
        : explains(phase, info.family)
          ? phase
          : boundary;
    } else {
      // Window messages and the event loop: any named activity says more.
      decided = activity >= 0 ? activity : phase >= 0 ? phase : boundary;
    }
  } else if (activity >= 0 && (firstWork < 0 || activity <= firstWork + 2)) {
    decided = activity;
  } else if (phase >= 0) {
    decided = phase;
  }

  let mechanism: MechanismId;
  let mechanismFrame = decided;
  let operation: string | undefined;
  let library: string | undefined;
  if (decided >= 0) {
    const rule = ruleAt(decided);
    mechanism = rule.mechanism;
    operation = rule.op;
  } else if (firstSystem >= 0 && (firstWork < 0 || firstSystem < firstWork)) {
    mechanism = "system-call";
    mechanismFrame = firstSystem;
    library = libNames[frameKeys[firstSystem]];
  } else if (firstWork >= 0) {
    mechanism = flags[frameKeys[firstWork]] & (FLAG_JS_ENGINE | FLAG_JS) ? "js" : "cpu";
    mechanismFrame = firstWork;
  } else {
    const jit = n > 1 && flags[frameKeys[1]] & FLAG_JS_ENGINE;
    mechanism = jit ? "js" : "unknown";
  }

  // The caller: the first distinctive Firefox frame above the mechanism. For
  // CPU work that is the working frame itself.
  let callerFrame = -1;
  const from =
    mechanism === "cpu" || mechanism === "js" ? Math.max(mechanismFrame, 0) : mechanismFrame + 1;
  for (let d = from; d < n; d++) {
    const f = frameKeys[d];
    const flag = flags[f];
    if (flag & (FLAG_PLUMBING | FLAG_SENTINEL) || !(flag & (FLAG_MOZILLA | FLAG_JS))) {
      continue;
    }
    if (mechRule[f] >= 0) {
      continue; // still part of the mechanism (a JSON helper, a lock wrapper)
    }
    callerFrame = d;
    break;
  }

  // Area: the innermost substantive match; generic layers only as a fallback.
  // The activity is the next different substantive area further out; a
  // generic layer ("during DOM") would add nothing.
  const areaPick = pickArea(frameKeys, table, 0, null, 1);
  const activityPick = areaPick
    ? pickArea(frameKeys, table, areaPick.depth + 1, areaPick.area, 2)
    : null;

  return {
    mechanism,
    mechanismFrame,
    operation,
    library,
    area: areaPick?.area ?? null,
    areaFrame: areaPick?.depth ?? -1,
    activity: activityPick?.area ?? null,
    activityFrame: activityPick?.depth ?? -1,
    callerFrame,
  };
}

/**
 * The innermost frame naming an area other than `exclude`, preferring a
 * substantive (weight 2+) match anywhere over a generic one nearer the leaf.
 * Looking for the activity (`exclude` set), the native message pump is passed
 * over: an input method's hook in `PeekMessage` dispatching a window message
 * doesn't mean the user was typing.
 */
function pickArea(
  frameKeys: ArrayLike<number>,
  { area: areaRule, mechanism: mechRule, flags }: FrameTable,
  from: number,
  exclude: AreaId | null,
  minWeight: Weight,
): { area: AreaId; depth: number } | null {
  let fallback: { area: AreaId; depth: number } | null = null;
  for (let d = from; d < frameKeys.length; d++) {
    const f = frameKeys[d];
    const rule = areaRule[f];
    if (rule < 0 || flags[f] & FLAG_PLUMBING) {
      continue;
    }
    if (exclude && mechRule[f] >= 0 && PUMPS.has(MECHANISM_RULES[mechRule[f]].mechanism)) {
      continue;
    }
    const { area, weight } = AREA_RULES[rule];
    if (area === exclude || weight < minWeight) {
      continue;
    }
    if (weight >= 2) {
      return { area, depth: d };
    }
    fallback ??= { area, depth: d };
  }
  return fallback;
}

const PUMPS = new Set<MechanismId>(["event-loop", "window-message"]);

/** URL value for hangs no area rule matched. */
export const NO_AREA = "none";
export type AreaFilter = AreaId | typeof NO_AREA;

export function isAreaFilter(value: string | null): value is AreaFilter {
  return !!value && (value === NO_AREA || Object.hasOwn(AREAS, value));
}

export function isMechanism(value: string | null): value is MechanismId {
  return !!value && Object.hasOwn(MECHANISMS, value);
}

export function isContext(value: string | null): value is ContextId {
  return !!value && Object.hasOwn(CONTEXTS, value);
}

/** Whether a hang is in the area the list is narrowed to. */
export function inArea(kind: HangKind, filter: AreaFilter): boolean {
  return filter === NO_AREA ? kind.area === null : kind.area === filter;
}

// -- Describing a hang --------------------------------------------------------

export function areaLabel(area: AreaId | null): string {
  return area ? AREAS[area] : "Unattributed";
}

/** "File I/O (open)", "Call into DWrite", "Lock wait". */
export function mechanismLabel(
  kind: Pick<HangKind, "mechanism" | "operation" | "library">,
): string {
  if (kind.library) {
    return `Call into ${kind.library}`;
  }
  const { label } = MECHANISMS[kind.mechanism];
  return kind.operation ? `${label} (${kind.operation})` : label;
}

/** Areas a mechanism already names, so the title doesn't say it twice. */
const SELF_NAMED: Partial<Record<MechanismId, AreaId>> = {
  gc: "js-engine",
  cc: "cycle-collector",
  clipboard: "clipboard",
};

/**
 * A short evidence-based title: "Startup cache: lock wait". The activity is
 * left to `activityText`, so the list can set it in a lighter weight.
 */
export function hangTitle(kind: HangKind): string {
  if (!kind.area || SELF_NAMED[kind.mechanism] === kind.area) {
    return mechanismLabel(kind);
  }
  const what = kind.library
    ? `call into ${kind.library}`
    : MECHANISMS[kind.mechanism].phrase + (kind.operation ? ` (${kind.operation})` : "");
  return `${AREAS[kind.area]}: ${what}`;
}

/** "during JS module loading", or "" when no further area was found. */
export function activityText(kind: HangKind): string {
  return kind.activity ? `during ${AREAS[kind.activity]}` : "";
}

// -- Context ------------------------------------------------------------------

export type ContextId =
  | "startup"
  | "shutdown"
  | "interacting"
  | "paint-pending"
  | "pending-input"
  | "external-cpu";

interface ContextInfo {
  label: string;
  /** Annotation key Firefox records it under. */
  key: string;
}

export const CONTEXTS: Record<ContextId, ContextInfo> = {
  startup: { label: "Startup", key: "BeforeStartupCrashAndHangTrackingEnded" },
  shutdown: { label: "Shutdown", key: "ShutdownImpending" },
  interacting: { label: "User interacting", key: "UserInteracting" },
  "paint-pending": { label: "Paint pending", key: "PaintPending" },
  "pending-input": { label: "Input waiting", key: "PendingInput" },
  "external-cpu": { label: "Other apps busy (CPU)", key: "ExternalCPUHigh" },
};

const CONTEXT_KEYS = new Set(Object.values(CONTEXTS).map((c) => c.key));

/** A context's share of a hang's reports, by hang count. */
export interface ContextShare {
  id: ContextId | null;
  /** The annotation key, for stopwatch keys that have no ContextId. */
  key: string;
  label: string;
  /** Fraction of the hang's reports carrying the annotation, in [0, 1]. */
  share: number;
}

/**
 * The contexts a hang's reports carry, largest share first. A report without
 * an annotation is unknown rather than "not interacting": Firefox only records
 * these flags when they are set, and older builds record fewer of them, so the
 * share is a floor. Other keys are user-interaction stopwatches (e.g.
 * `browser.tabs.opening`), named after what the user was doing.
 */
export function hangContext(stats: AnnotationStats, count: number): ContextShare[] {
  if (count <= 0) {
    return [];
  }
  const out: ContextShare[] = [];
  for (const [id, info] of Object.entries(CONTEXTS) as [ContextId, ContextInfo][]) {
    const stat = stats[info.key];
    if (!stat) {
      continue;
    }
    // Boolean flags are recorded as "true"; PendingInput is a count, where any
    // non-zero value means input was queued.
    const hits =
      id === "pending-input"
        ? Object.entries(stat.values).reduce((s, [v, c]) => (Number(v) > 0 ? s + c : s), 0)
        : (stat.values["true"] ?? 0);
    if (hits > 0) {
      out.push({ id, key: info.key, label: info.label, share: Math.min(hits / count, 1) });
    }
  }
  for (const [key, stat] of Object.entries(stats)) {
    if (!CONTEXT_KEYS.has(key) && stat.totalCount > 0) {
      out.push({ id: null, key, label: key, share: Math.min(stat.totalCount / count, 1) });
    }
  }
  return out.sort((a, b) => b.share - a.share);
}

/** Whether most of a hang's reports carry a context, for list filtering. */
export function hasContext(
  stats: AnnotationStats,
  count: number,
  id: ContextId,
  threshold = 0.5,
): boolean {
  const stat = stats[CONTEXTS[id].key];
  if (!stat || count <= 0) {
    return false;
  }
  const hits =
    id === "pending-input"
      ? Object.entries(stat.values).reduce((s, [v, c]) => (Number(v) > 0 ? s + c : s), 0)
      : (stat.values["true"] ?? 0);
  return hits / count >= threshold;
}
