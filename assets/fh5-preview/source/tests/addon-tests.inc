static const char *addon_reply;
HRESULT xodus_store_addon_inventory_xml(const char *request,SIZE_T size,char **out,UINT16 *length)
{
    *out=NULL;*length=0;
    if(!addon_reply)return E_FAIL;
    *out=strdup(addon_reply);if(!*out)return E_OUTOFMEMORY;*length=strlen(*out);return S_OK;
}
#include "xstore_addon_licenses.h"
static char *inventory_xml(const char *products)
{
    char *out=malloc(16000);
    snprintf(out,16000,"<Response><HResult>0</HResult><ParentProductId>B00000000001</ParentProductId><InventoryComplete>true</InventoryComplete><ValidUntil>%llu</ValidUntil>%s</Response>",(unsigned long long)time(NULL)+60,products);
    return out;
}
static const char *addon_products="<Product><StoreId>B00000000002</StoreId><AssociatedDurable>true</AssociatedDurable><InAppOfferToken>owned-offer</InAppOfferToken><Sku><SkuId>0010</SkuId><HasPackages>false</HasPackages></Sku><Sku><SkuId>0011</SkuId><HasPackages>true</HasPackages></Sku></Product><Product><StoreId>B00000000003</StoreId><AssociatedDurable>false</AssociatedDurable><InAppOfferToken></InAppOfferToken></Product>";
static void addon_data_tests(void)
{
    struct addon_inventory *inventory=NULL;XStoreAddonLicense *out=NULL;UINT32 count=123;
    char *xml=inventory_xml(addon_products);UINT64 now=time(NULL);
    struct receipt_license proof[4]={{"B00000000001","0010",now+3600},{"B00000000002","0010",now+1200},{"B00000000002","0011",now+1200},{"B00000000003","0010",now+1200}};
    CHECK("addon-metadata-parsed",addon_parse_inventory(xml,strlen(xml),&inventory)==S_OK&&inventory&&inventory->count==2);
    CHECK("addon-owned-digital-sku",addon_materialize(inventory,proof,3,now+60,&out,&count)==S_OK&&count==1&&out);
    if(out){CHECK("addon-exact-sku-offer-expiry",!strcmp(out[0].skuStoreId,"B00000000002/0010")&&!strcmp(out[0].inAppOfferToken,"owned-offer")&&out[0].isActive&&out[0].expirationDate==now+1200);free(out);}
    CHECK("addon-discovery-does-not-grant",addon_materialize(inventory,proof,1,now+60,&out,&count)==S_OK&&!count);free(out);
    CHECK("addon-unknown-licensed-type-fails",addon_materialize(inventory,proof,4,now+60,&out,&count)==E_NOTIMPL&&!out&&!count);
    CHECK("addon-without-base-proof-denied",addon_materialize(inventory,proof+1,1,now+60,&out,&count)==E_ACCESSDENIED&&!out&&!count);
    proof[0].expiry=now-1;CHECK("addon-expired-base-denied",addon_materialize(inventory,proof,3,now+60,&out,&count)==E_ACCESSDENIED);proof[0].expiry=now+3600;
    proof[1].expiry=now-1;CHECK("addon-inactive-signed-row",addon_materialize(inventory,proof,2,now+60,&out,&count)==S_OK&&count==1&&out&&!out[0].isActive&&out[0].expirationDate==now-1);free(out);proof[1].expiry=now+1200;
    strcpy(proof[1].sku,"0099");CHECK("addon-unknown-licensed-sku-fails",addon_materialize(inventory,proof,2,now+60,&out,&count)==E_NOTIMPL&&!out&&!count);strcpy(proof[1].sku,"0010");
    CHECK("addon-expired-proof-denied",addon_materialize(inventory,proof,3,now,&out,&count)==E_ACCESSDENIED);
    inventory->valid_until=now;CHECK("addon-stale-discovery-denied",addon_materialize(inventory,proof,3,now+60,&out,&count)==E_ACCESSDENIED);free(inventory);
    char *empty=inventory_xml("");CHECK("addon-empty-discovery-parsed",addon_parse_inventory(empty,strlen(empty),&inventory)==S_OK);CHECK("addon-genuine-zero-result",addon_materialize(inventory,proof,1,now+60,&out,&count)==S_OK&&!count);free(out);free(inventory);free(empty);
    const char *bad[]={"<Response><HResult>0</HResult></Response>","<!DOCTYPE x><Response/>","<Response><HResult>0</HResult><HResult>0</HResult></Response>"};
    for(UINT i=0;i<ARRAY_SIZE(bad);i++)CHECK("addon-malformed-discovery",FAILED(addon_parse_inventory(bad[i],strlen(bad[i]),&inventory))&&!inventory);
    const char *bad_products[]={"<Product><StoreId>B00000000001</StoreId><AssociatedDurable>false</AssociatedDurable><InAppOfferToken/></Product>","<Product><StoreId>bad</StoreId><AssociatedDurable>false</AssociatedDurable><InAppOfferToken/></Product>","<Product><StoreId>B00000000002</StoreId><AssociatedDurable>true</AssociatedDurable><InAppOfferToken/></Product>","<Product><StoreId>B00000000002</StoreId><AssociatedDurable>false</AssociatedDurable><InAppOfferToken/><Sku><SkuId>0010</SkuId><HasPackages>false</HasPackages></Sku></Product>"};
    for(UINT i=0;i<ARRAY_SIZE(bad_products);i++){char *invalid=inventory_xml(bad_products[i]);CHECK("addon-bad-kind-sku-layout",FAILED(addon_parse_inventory(invalid,strlen(invalid),&inventory))&&!inventory);free(invalid);}
    const char *json="{\"tokenVersion\":1,\"licensableProducts\":[{\"productId\":\"B00000000001\",\"skuId\":\"0010\",\"endDate\":\"2099-01-01T00:00:00Z\"},{\"productId\":\"B00000000002\",\"skuId\":\"0010\",\"endDate\":\"2020-01-01T00:00:00Z\"},{\"productId\":\"B00000000004\",\"skuId\":\"0010\",\"endDate\":\"2099-01-01T00:00:00Z\"}]}";
    IJsonObject *claim=NULL;const char *ids[]={"B00000000001","B00000000002"};struct receipt_license licenses[ENTITLED_MAX_PRODUCTS];UINT32 n=0;
    CHECK("addon-claim-json",receipt_json((const BYTE*)json,strlen(json),&claim)==S_OK);
    CHECK("addon-filter-unrequested-retain-inactive",addon_receipt_inventory(claim,ids,2,licenses,&n)==S_OK&&n==2&&licenses[1].expiry<now);IJsonObject_Release(claim);
    free(xml);
}
static unsigned addon_cleanups;
static HRESULT WINAPI addon_success_provider(XAsyncOp op,const XAsyncProviderData *data)
{
    struct addon_async *context=data->context;
    if(op==XAsyncOp_DoWork){IXThreadingImpl_XAsyncComplete(context->threading,data->async,S_OK,context->count*sizeof(XStoreAddonLicense));return S_OK;}
    if(op==XAsyncOp_Cleanup)addon_cleanups++;
    return addon_provider(op,data);
}
static void addon_async_tests(void)
{
    IXThreadingImpl *threads=NULL;XTaskQueueHandle queue=NULL;XStoreContextHandle store=NULL;XAsyncBlock block={0};UINT32 count;XStoreAddonLicense result;
    CHECK("addon-threading",QueryApiImpl(&CLSID_XThreadingImpl,&IID_IXThreadingImpl,(void**)&threads)==S_OK);
    CHECK("addon-queue",IXThreadingImpl_XTaskQueueCreate(threads,XTaskQueueDispatchMode_Manual,XTaskQueueDispatchMode_Manual,&queue)==S_OK);
    CHECK("addon-context",entitled_store_create(NULL,&store)==S_OK);
    CHECK("addon-invalid-context",addon_begin((void*)1,&block)==E_INVALIDARG);
    CHECK("addon-null-block",addon_begin(store,NULL)==E_INVALIDARG);
    for(UINT mode=0;mode<3;mode++){
        char *xml=inventory_xml(addon_products);addon_reply=xml;ResetEvent(bridge_started);ResetEvent(bridge_gate);callbacks=0;memset(&block,0,sizeof(block));block.queue=queue;block.callback=complete;
        CHECK("addon-real-provider-begin",addon_begin(store,&block)==S_OK);
        if(mode!=1){CHECK("addon-real-provider-work",IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0));CHECK("addon-proof-worker-starts",WaitForSingleObject(bridge_started,2000)==WAIT_OBJECT_0);}
        if(mode)IXThreadingImpl_XAsyncCancel(threads,&block);
        if(mode==1)IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0);
        SetEvent(bridge_gate);dispatch_until_complete(threads,queue,&block);count=123;
        CHECK("addon-transport-error-not-zero-success",addon_count(&block,&count)==(mode?E_ABORT:E_FAIL)&&!count);
        CHECK("addon-one-error-callback",callbacks==1);
        ULONGLONG start=GetTickCount64();while(bridge_active&&GetTickCount64()-start<2000)Sleep(1);CHECK("addon-error-worker-finishes",!bridge_active);free(xml);addon_reply=NULL;
    }
    for(UINT n=0;n<2;n++)for(UINT early=0;early<2;early++){
        struct addon_async *context=calloc(1,sizeof(*context));context->refs=1;context->count=n;context->proof_until=time(NULL)+60;
        QueryApiImpl(&CLSID_XThreadingImpl,&IID_IXThreadingImpl,(void**)&context->threading);
        if(n){context->licenses=calloc(1,sizeof(*context->licenses));strcpy(context->licenses[0].skuStoreId,"B00000000002/0010");context->licenses[0].isActive=TRUE;}
        memset(&block,0,sizeof(block));block.queue=queue;block.callback=complete;callbacks=0;addon_cleanups=0;
        CHECK("addon-success-begin",IXThreadingImpl_XAsyncBegin(threads,&block,context,&addon_identity,"OfflineAddonFixture",addon_success_provider)==S_OK);
        IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0);
        if(!early)dispatch_until_complete(threads,queue,&block);
        if(!n&&!early)CHECK("addon-zero-cleans-without-result",addon_cleanups==1);
        count=123;CHECK("addon-count-nonconsuming",addon_count(&block,&count)==S_OK&&count==n);count=123;CHECK("addon-repeat-count",addon_count(&block,&count)==S_OK&&count==n);
        if(n)CHECK("addon-small-result-retryable",addon_result(&block,0,NULL)==HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
        memset(&result,0,sizeof(result));CHECK("addon-result-zero-or-array",addon_result(&block,n,n?&result:NULL)==S_OK);
        if(n)CHECK("addon-array-values",!strcmp(result.skuStoreId,"B00000000002/0010")&&result.isActive);
        CHECK("addon-result-once",addon_result(&block,n,n?&result:NULL)==(n?E_ILLEGAL_METHOD_CALL:S_OK));
        if(early){CHECK("addon-cleanup-waits-for-callback",!addon_cleanups);dispatch_until_complete(threads,queue,&block);}
        CHECK("addon-success-one-callback-cleanup",callbacks==1&&addon_cleanups==1);
    }
    entitled_store_close(store);IXThreadingImpl_XTaskQueueCloseHandle(threads,queue);IXThreadingImpl_Release(threads);
}
