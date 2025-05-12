const typing = async function (ctx: any, provider: any) {
  if (provider && provider?.vendor && provider.vendor?.sendPresenceUpdate) {
    const id = ctx.key.remoteJid;
    await provider.vendor.sendPresenceUpdate("composing", id);
  }
};

export { typing };
