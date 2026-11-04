#define main original_store_probe_main
#include "store-entitlements-probe.c"
#undef main
#include "xstore_products.h"
#include "store-product-fixtures.h"

static HRESULT catalog_fixture(const char *name, struct products_async *context, const struct receipt_license *licenses, UINT count, UINT64 expiry, struct entitled_snapshot **out)
{
    for (UINT i = 0; i < ARRAY_SIZE(product_fixtures); i++)
        if (!strcmp(name, product_fixtures[i].name))
            return products_catalog((const BYTE *)product_fixtures[i].json,
                strlen(product_fixtures[i].json), context, licenses, count, expiry, out);
    *out = NULL;
    return E_FAIL;
}
static void query_parser_tests(void)
{
    struct products_async context={0}; struct entitled_snapshot *snapshot=NULL;
    struct receipt_license license={"B00000000001","0010",time(NULL)+3600};
    UINT64 expiry=time(NULL)+600;
    strcpy(context.ids[0],"B00000000001");context.count=1;context.kinds=31;
    CHECK("public-unowned-listing",catalog_fixture("fixture",&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && snapshot->count==1);
    if(snapshot){
        XStoreProduct *p=&snapshot->products[0];
        CHECK("public-catalog-never-grants-ownership",!p->isInUserCollection && !p->skus[0].isInUserCollection && !p->skus[0].collectionData.endDate);
        CHECK("actual-catalog-title-kind",!strcmp(p->title,"Synthetic add-on") && p->productKind==2 && !p->hasDigitalDownload);
        CHECK("actual-catalog-prices",p->price.price==10 && p->price.basePrice==20 && p->price.isOnSale && !strcmp(p->price.currencyCode,"USD"));
        CHECK("actual-catalog-availability",p->skus[0].availabilitiesCount==1 && !strcmp(p->skus[0].availabilities[0].availabilityId,"A1"));
        entitled_snapshot_release(snapshot);
    }
    /* Display pricing must prefer Purchase across SKU ordering, including
     * real free purchases rather than inferring preference from price > 0. */
    {
        const char *mixed[] = {"details-before-purchase", "purchase-before-details",
            "details-before-free-purchase", "free-purchase-before-details"};
        for (UINT i = 0; i < ARRAY_SIZE(mixed); i++)
        {
            CHECK("mixed-sku-query", catalog_fixture(mixed[i], &context, NULL, 0, expiry, &snapshot) == S_OK && snapshot && snapshot->count == 1);
            if (snapshot)
            {
                CHECK("purchase-price-across-skus", snapshot->products[0].price.price == (i < 2 ? 10 : 0) &&
                    snapshot->products[0].price.basePrice == (i < 2 ? 20 : 0));
                entitled_snapshot_release(snapshot);
            }
        }
    }
    CHECK("owned-exact-sku",catalog_fixture("two-skus",&context,&license,1,expiry,&snapshot)==S_OK && snapshot && snapshot->count==1);
    if(snapshot){
        CHECK("one-sku-owned-not-all",snapshot->products[0].isInUserCollection && snapshot->products[0].skus[0].isInUserCollection && !snapshot->products[0].skus[1].isInUserCollection && snapshot->products[0].skus[1].isTrial);
        CHECK("receipt-expiration",snapshot->products[0].skus[0].collectionData.endDate==license.expiry);
        entitled_snapshot_release(snapshot);
    }
    license.expiry=time(NULL)-1;
    CHECK("expired-license-query",catalog_fixture("fixture",&context,&license,1,expiry,&snapshot)==S_OK);
    if(snapshot){CHECK("expired-license-not-owned",!snapshot->products[0].isInUserCollection);entitled_snapshot_release(snapshot);}
    strcpy(license.id,"B00000000002");license.expiry=time(NULL)+600;
    CHECK("other-license-query",catalog_fixture("fixture",&context,&license,1,expiry,&snapshot)==S_OK);
    if(snapshot){CHECK("unrelated-license-not-owned",!snapshot->products[0].isInUserCollection);entitled_snapshot_release(snapshot);}
    const char *bad[]={"unrequested","duplicate","bad-date","bad-price","bad-trial"};
    for(UINT i=0;i<ARRAY_SIZE(bad);i++)CHECK(bad[i],FAILED(catalog_fixture(bad[i],&context,NULL,0,expiry,&snapshot)) && !snapshot);
    CHECK("expired-proof-rejected",catalog_fixture("fixture",&context,NULL,0,time(NULL),&snapshot)==E_ACCESSDENIED && !snapshot);
    context.actions=1;
    CHECK("purchase-matches",catalog_fixture("fixture",&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && snapshot->count==1);if(snapshot)entitled_snapshot_release(snapshot);
    const char *filtered[]={"delisted","empty-availability","future-availability"};
    for(UINT i=0;i<ARRAY_SIZE(filtered);i++){CHECK(filtered[i],catalog_fixture(filtered[i],&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && !snapshot->count);if(snapshot)entitled_snapshot_release(snapshot);}
    context.actions=0;
    for(UINT i=0;i<ARRAY_SIZE(filtered);i++){CHECK("unfiltered-delisted-retained",catalog_fixture(filtered[i],&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && snapshot->count==1);if(snapshot)entitled_snapshot_release(snapshot);}
    context.actions=1u<<5;
    CHECK("details-filter",catalog_fixture("delisted",&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && snapshot->count==1);if(snapshot)entitled_snapshot_release(snapshot);
    context.actions=0;context.kinds=4;
    CHECK("kind-filter",catalog_fixture("fixture",&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && !snapshot->count);if(snapshot)entitled_snapshot_release(snapshot);
    context.kinds=31;
    CHECK("package-metadata",catalog_fixture("packaged",&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && snapshot->products[0].hasDigitalDownload);if(snapshot)entitled_snapshot_release(snapshot);
    CHECK("unknown-kind-omitted",catalog_fixture("unknown-type",&context,NULL,0,expiry,&snapshot)==S_OK && snapshot && !snapshot->count);if(snapshot)entitled_snapshot_release(snapshot);

}
static void query_async_tests(void)
{
    IXThreadingImpl *threads=NULL;XTaskQueueHandle queue=NULL;XStoreContextHandle store=NULL;
    const char *ids[]={"B00000000001"};const char *filter[]={"Invalid"};XAsyncBlock block={0};XStoreProductQueryHandle result;
    CHECK("products-threading",QueryApiImpl(&CLSID_XThreadingImpl,&IID_IXThreadingImpl,(void**)&threads)==S_OK);
    CHECK("products-queue",IXThreadingImpl_XTaskQueueCreate(threads,XTaskQueueDispatchMode_Manual,XTaskQueueDispatchMode_Manual,&queue)==S_OK);
    CHECK("products-context",entitled_store_create(NULL,&store)==S_OK);
    block.queue=queue;
    CHECK("products-max100",products_begin(store,31,ids,101,NULL,0,&block)==E_INVALIDARG);
    CHECK("products-invalid-context",products_begin((void*)1,31,ids,1,NULL,0,&block)==E_INVALIDARG);
    CHECK("products-invalid-filter",products_begin(store,31,ids,1,filter,1,&block)==E_INVALIDARG);
    CHECK("products-empty-ids",products_begin(store,31,ids,0,NULL,0,&block)==E_INVALIDARG);
    CHECK("products-invalid-kinds",products_begin(store,32,ids,1,NULL,0,&block)==E_INVALIDARG);
    CHECK("products-missing-filter-array",products_begin(store,31,ids,1,NULL,1,&block)==E_INVALIDARG);
    for(UINT mode=0;mode<3;mode++){
        callbacks=0;ResetEvent(bridge_started);ResetEvent(bridge_gate);memset(&block,0,sizeof(block));block.queue=queue;block.callback=complete;
        CHECK("products-begin",products_begin(store,31,ids,1,NULL,0,&block)==S_OK);
        if(mode!=1){CHECK("products-work-nonblocking",IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0));CHECK("products-network-worker",WaitForSingleObject(bridge_started,2000)==WAIT_OBJECT_0);}
        if(mode)IXThreadingImpl_XAsyncCancel(threads,&block);
        if(mode==1)IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0);
        SetEvent(bridge_gate);dispatch_until_complete(threads,queue,&block);
        CHECK("products-error-completion",IXThreadingImpl_XAsyncGetStatus(threads,&block,FALSE)==(mode?E_ABORT:E_FAIL));
        CHECK("products-one-callback",callbacks==1);result=(void*)1;
        CHECK("products-no-handle-on-error",FAILED(products_result(&block,&result))&&!result);
        ULONGLONG start=GetTickCount64();while(bridge_active&&GetTickCount64()-start<2000)Sleep(1);CHECK("products-worker-released",!bridge_active);
    }
    entitled_store_close(store);IXThreadingImpl_XTaskQueueCloseHandle(threads,queue);IXThreadingImpl_Release(threads);
}
/* Replace only network work in this executable, retaining the production
 * provider's Begin/GetResult/Cleanup and runtime's real async machinery. */
static HRESULT WINAPI offline_success_provider(XAsyncOp op,const XAsyncProviderData *data)
{
    struct products_async *context=data->context;
    if(op==XAsyncOp_DoWork){IXThreadingImpl_XAsyncComplete(context->threading,data->async,S_OK,sizeof(void*));return S_OK;}
    return products_provider(op,data);
}
static void query_success_tests(void)
{
    IXThreadingImpl *threads=NULL;XTaskQueueHandle queue=NULL;struct products_async *context;
    struct entitled_snapshot *snapshot=NULL;XAsyncBlock block={0};XStoreProductQueryHandle handle=NULL;
    CHECK("success-threading",QueryApiImpl(&CLSID_XThreadingImpl,&IID_IXThreadingImpl,(void**)&threads)==S_OK);
    CHECK("success-queue",IXThreadingImpl_XTaskQueueCreate(threads,XTaskQueueDispatchMode_Manual,XTaskQueueDispatchMode_Manual,&queue)==S_OK);
    for(UINT expire=0;expire<2;expire++){
        context=calloc(1,sizeof(*context));context->refs=1;context->kinds=31;context->count=1;strcpy(context->ids[0],"B00000000001");
        CHECK("success-fixture",catalog_fixture("fixture",context,NULL,0,time(NULL)+600,&snapshot)==S_OK);
        context->page=calloc(1,sizeof(*context->page));context->page->refs=1;context->page->snapshot=snapshot;context->page->size=100;
        CHECK("success-provider-ref",QueryApiImpl(&CLSID_XThreadingImpl,&IID_IXThreadingImpl,(void**)&context->threading)==S_OK);
        memset(&block,0,sizeof(block));block.queue=queue;block.callback=complete;callbacks=0;
        CHECK("success-begin",IXThreadingImpl_XAsyncBegin(threads,&block,context,&products_identity,"OfflineProductFixture",offline_success_provider)==S_OK);
        IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0);dispatch_until_complete(threads,queue,&block);
        CHECK("success-one-callback",callbacks==1);
        CHECK("wrong-query-identity",entitled_result(&block,&handle,FALSE)==E_INVALIDARG&&!handle);
        if(expire)snapshot->valid_until=time(NULL);
        CHECK("product-handle-transfer",products_result(&block,&handle)==(expire?E_ACCESSDENIED:S_OK));
        if(!expire){
            enumerated=0;CHECK("returned-handle-enumerates",entitled_enumerate(handle,NULL,enumerate)==S_OK&&enumerated==1);
            CHECK("one-query-page",!entitled_has_more(handle));
            XStoreProductQueryHandle again=NULL;CHECK("result-consumed-once",products_result(&block,&again)==E_ILLEGAL_METHOD_CALL&&!again);
            enumerated=0;CHECK("close-from-callback",entitled_enumerate(handle,handle,close_during_callback)==S_OK&&enumerated==1);
            CHECK("closed-handle-not-reused",entitled_enumerate(handle,NULL,enumerate)==E_INVALIDARG);
        }else CHECK("expired-transfer-no-handle",!handle);
    }
    CHECK("success-no-leaked-page",!entitled_pages);
    IXThreadingImpl_XTaskQueueCloseHandle(threads,queue);IXThreadingImpl_Release(threads);
}
/* Verify that the newly implemented methods are wired through the real DLL
 * ABI. These closed argument checks must not start account/network work. */
static void query_abi_tests(void)
{
    IXStoreImpl6 *api = NULL;
    XAsyncBlock block = {0};
    XStoreProductQueryHandle result = NULL;
    const char *ids[] = {"B00000000001"};
    CHECK("runtime-products-interface", runtime_query(&CLSID_XStoreImpl, &IID_IXStoreImpl6, (void **)&api) == S_OK && api);
    if (!api) return;
    CHECK("runtime-products-null-async", IXStoreImpl6_XStoreQueryProductsAsync(api, NULL, 31, ids, 1, NULL, 0, NULL) == E_INVALIDARG);
    CHECK("runtime-products-bounded-ids", IXStoreImpl6_XStoreQueryProductsAsync(api, NULL, 31, ids, 101, NULL, 0, &block) == E_INVALIDARG);
    CHECK("runtime-products-empty-ids", IXStoreImpl6_XStoreQueryProductsAsync(api, NULL, 31, ids, 0, NULL, 0, &block) == E_INVALIDARG);
    CHECK("runtime-products-null-result", IXStoreImpl6_XStoreQueryProductsResult(api, &block, NULL) == E_INVALIDARG);
    CHECK("runtime-products-null-result-async", IXStoreImpl6_XStoreQueryProductsResult(api, NULL, &result) == E_INVALIDARG);
    IXStoreImpl6_Release(api);
}

int main(void)
{
    setvbuf(stdout, NULL, _IONBF, 0);
    int original=original_store_probe_main();
    HRESULT hr=RoInitialize(RO_INIT_MULTITHREADED);
    bridge_started=CreateEventW(NULL,TRUE,FALSE,NULL);bridge_gate=CreateEventW(NULL,TRUE,FALSE,NULL);
    query_abi_tests();query_parser_tests();query_async_tests();query_success_tests();
    CloseHandle(bridge_started);CloseHandle(bridge_gate);
    if(SUCCEEDED(hr))RoUninitialize();
    printf("ALL_STORE_CHECKS %u FAILURES %u\n",checks,failures);return original||failures?1:0;
}
