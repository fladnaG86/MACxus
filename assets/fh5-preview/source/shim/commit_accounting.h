#ifndef MACXUS_COMMIT_ACCOUNTING_H
#define MACXUS_COMMIT_ACCOUNTING_H
struct guest_commit_snapshot { ULONGLONG private_bytes,copy_bytes;unsigned regions;ULONGLONG duration_us; };
static BOOL guest_commit_scan(struct guest_commit_snapshot *out)
{
 SYSTEM_INFO sys;LARGE_INTEGER begin,end,frequency;GetSystemInfo(&sys);QueryPerformanceFrequency(&frequency);QueryPerformanceCounter(&begin);
 uintptr_t at=(uintptr_t)sys.lpMinimumApplicationAddress,maximum=(uintptr_t)sys.lpMaximumApplicationAddress;*out=(struct guest_commit_snapshot){0};
 while(at<=maximum){MEMORY_BASIC_INFORMATION m;
  if(VirtualQuery((void*)at,&m,sizeof(m))!=sizeof(m))return FALSE;
  uintptr_t base=(uintptr_t)m.BaseAddress;
  if(!m.RegionSize || base>at || m.RegionSize>UINTPTR_MAX-base || base+m.RegionSize<=at)return FALSE;
  ULONGLONG *count=NULL;
  if(m.State==MEM_COMMIT){if(m.Type==MEM_PRIVATE)count=&out->private_bytes;else if((m.Protect&0xff)==PAGE_WRITECOPY || (m.Protect&0xff)==PAGE_EXECUTE_WRITECOPY)count=&out->copy_bytes;}
  if(count){if(*count>UINT64_MAX-m.RegionSize)return FALSE;*count+=m.RegionSize;}
  if(++out->regions>1000000)return FALSE;
  at=base+m.RegionSize;
 }
 if(out->private_bytes>UINT64_MAX-out->copy_bytes)return FALSE;
 QueryPerformanceCounter(&end);out->duration_us=(end.QuadPart-begin.QuadPart)*1000000/frequency.QuadPart;return TRUE;
}
static SRWLOCK guest_commit_lock=SRWLOCK_INIT;
static struct guest_commit_snapshot guest_commit_cache;
static ULONGLONG guest_commit_tick;
static BOOL guest_commit_valid;
static BOOL guest_commit_get(struct guest_commit_snapshot *out)
{
 BOOL valid;ULONGLONG now=GetTickCount64();
 AcquireSRWLockExclusive(&guest_commit_lock);
 if(!guest_commit_valid || now-guest_commit_tick>=1000){struct guest_commit_snapshot fresh;
  if(guest_commit_scan(&fresh)){guest_commit_cache=fresh;guest_commit_tick=GetTickCount64();guest_commit_valid=TRUE;}
 }
 valid=guest_commit_valid && GetTickCount64()-guest_commit_tick<=1000;
 if(valid)*out=guest_commit_cache;
 ReleaseSRWLockExclusive(&guest_commit_lock);return valid;
}
#endif
