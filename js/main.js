/* Start-up. */
initTheme();
{const v=viewFromHash();if(v!=='home'&&v!=='case')go(v,{fromHistory:true,silent:true})}

renderHome();

/* Photos: move any legacy inline images into IndexedDB, then clean up photos no case uses. */
(async()=>{
 if(await moveInlineImagesToDb(state.cases))save();
 if(!stateRecovered)await purgeOrphanImages();
})().catch(()=>{});
