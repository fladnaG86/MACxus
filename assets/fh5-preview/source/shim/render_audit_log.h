#ifndef MACXUS_RENDER_AUDIT_LOG_H
#define MACXUS_RENDER_AUDIT_LOG_H
/* Separate bounded metadata file. Diagnostic loss is counted; a missing final
 * summary or a missing record must never establish complete coverage. */
static LONG64 render_audit_attempts,render_audit_written,render_audit_lost;
static SRWLOCK render_audit_output_lock=SRWLOCK_INIT;
static BOOL render_audit_note(const char *format,...)
{
    DWORD saved=GetLastError(),n,written=0;
    BOOL success=FALSE,locked=FALSE;WCHAR path[MAX_PATH];char line[1024];va_list args;
    LONG64 attempt=InterlockedIncrement64(&render_audit_attempts);
    n=GetEnvironmentVariableW(L"MACXUS_FH5_RENDER_AUDIT_LOG",path,MAX_PATH);
    if(!n||n>=MAX_PATH)goto done;
    int at=snprintf(line,sizeof line,"RENDER_META pid=%lu tick=%llu attempt=%lld prior_written=%lld prior_lost=%lld ",
        (unsigned long)GetCurrentProcessId(),(unsigned long long)GetTickCount64(),(long long)attempt,
        (long long)InterlockedCompareExchange64(&render_audit_written,0,0),
        (long long)InterlockedCompareExchange64(&render_audit_lost,0,0));
    if(at<0||(unsigned)at>=sizeof line)goto done;
    va_start(args,format);int count=vsnprintf(line+at,sizeof line-at,format,args);va_end(args);
    if(count<0||(unsigned)count>=sizeof line-at-1)goto done;
    count+=at;line[count++]='\n';
    AcquireSRWLockExclusive(&render_audit_output_lock);locked=TRUE;
    HANDLE file=CreateFileW(path,FILE_APPEND_DATA|GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file!=INVALID_HANDLE_VALUE) {
        LARGE_INTEGER size;OVERLAPPED overlap={0};
        if(GetFileType(file)==FILE_TYPE_DISK&&LockFileEx(file,LOCKFILE_EXCLUSIVE_LOCK|LOCKFILE_FAIL_IMMEDIATELY,0,MAXDWORD,MAXDWORD,&overlap)) {
            if(GetFileSizeEx(file,&size)&&size.QuadPart+count<=8*1024*1024)
                success=WriteFile(file,line,count,&written,NULL)&&written==(DWORD)count;
            UnlockFileEx(file,0,MAXDWORD,MAXDWORD,&overlap);
        }
        CloseHandle(file);
    }
done:
    if(locked)ReleaseSRWLockExclusive(&render_audit_output_lock);
    if(success)InterlockedIncrement64(&render_audit_written);else InterlockedIncrement64(&render_audit_lost);
    SetLastError(saved);return success;
}
#endif
