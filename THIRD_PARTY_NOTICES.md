# Third-party notices

The custom KeRnCloud license applies only to original KeRnCloud material. It does not restrict rights granted by upstream licenses.

- JavaScript dependencies: exact versions and registry integrity values are recorded in package-lock.json and desktop-app/package-lock.json. Installed packages retain their own LICENSE / NOTICE files. The desktop runtime includes Electron/Chromium notices.
- Bundled invoice validators/configuration: vendor/einvoice/provenance.json lists upstream download URLs and SHA-256 hashes. The original JAR/ZIP archives retain their embedded notices; extracted notices are also preserved in vendor/einvoice/licenses. Corresponding upstream projects: https://github.com/itplr-kosit/validator , https://github.com/ZUGFeRD/mustangproject , https://github.com/itplr-kosit/validator-configuration-xrechnung . Their source and licenses remain available from those projects and their dependency notices.
- Font: Manrope, SIL Open Font License; public/images/landing/OFL-Manrope.txt. Other installed fonts retain their package licenses.
- Photography: illustrative Unsplash assets, not customer endorsements. Original sources and license references: public/images/directions/SOURCES.txt, public/images/directions-hd/SOURCES.txt and public/images/landing/SOURCES.txt.
- Dashboard captures: original KeRnCloud interface, neutral test data; public/images/workspace-vector/SOURCES.txt.
- Container base images and OS tools: Node.js, PostgreSQL, Debian packages, Chromium, OpenJDK and Poppler retain their respective licenses and package copyright notices inside the images. They are not relicensed under KeRnCloud's commercial restrictions.

The first public release requires a dependency/asset rights review and a reproducible license inventory. This file records provenance; it is not a claim that all upstream obligations have already been legally audited.
