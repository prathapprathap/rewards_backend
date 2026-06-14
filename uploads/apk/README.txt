APK hosting folder
==================

Drop your built Android APK into THIS folder. That's the whole "manual upload" step.

  - Any file ending in .apk works (e.g. app-release.apk).
  - If you upload more than one, the NEWEST .apk (by modified time) is served,
    so you can just drop a new build to publish a new version.
  - It is served (with referral attribution) at:
        GET /api/download                  -> APK directly, no referral
        GET /api/download/file             -> APK directly (binary)
        GET /api/download/<REFERRAL_CODE>  -> interstitial that copies the code,
                                              then downloads the APK

Deployment note
---------------
If this backend runs on a host with an EPHEMERAL filesystem (e.g. Render free
tier), a manually-uploaded APK is wiped on every redeploy/restart. Keep the APK
on a persistent disk/volume, or re-upload after each deploy.
