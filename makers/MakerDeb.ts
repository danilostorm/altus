import { MakerBase, MakerOptions } from "@electron-forge/maker-base";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs-extra";
import { buildForge } from "app-builder-lib";
import { CommonConfig } from "./CommonConfig";

const execFileAsync = promisify(execFile);
const APP_ID = "harwara.aman.altus";
const DEBIAN_REVISION = "4";

export default class MakerDeb extends MakerBase<MakerOptions> {
  name = "deb";

  defaultPlatforms: string[] = ["linux"];

  isSupportedOnCurrentPlatform(): boolean {
    return process.platform === "linux";
  }

  private async appendIconCacheRefresh(scriptPath: string): Promise<void> {
    if (!(await fs.pathExists(scriptPath))) {
      return;
    }

    const script = await fs.readFile(scriptPath, "utf8");
    const marker = "# Refresh Altus desktop integration caches";

    if (script.includes(marker)) {
      return;
    }

    await fs.writeFile(
      scriptPath,
      `${script.trimEnd()}\n\n${marker}\nif command -v gtk-update-icon-cache >/dev/null 2>&1; then\n  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true\nfi\n\nif command -v update-desktop-database >/dev/null 2>&1; then\n  update-desktop-database -q /usr/share/applications || true\nfi\n`,
      { mode: 0o755 }
    );
  }

  private async ensureInstallDirectoryAccess(scriptPath: string): Promise<void> {
    if (!(await fs.pathExists(scriptPath))) {
      return;
    }

    const script = await fs.readFile(scriptPath, "utf8");
    const marker = "# Ensure Altus is accessible to desktop users";

    if (script.includes(marker)) {
      return;
    }

    await fs.writeFile(
      scriptPath,
      `${script.trimEnd()}\n\n${marker}\nchmod 0755 /opt/Altus || true\nchmod 0755 /opt/Altus/Altus || true\n`,
      { mode: 0o755 }
    );
  }

  private updateControlMetadata(control: string, version: string): string {
    const lines = control.split(/\r?\n/);
    const result: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      if (line.startsWith("Version:")) {
        result.push(`Version: ${version}`);
        continue;
      }

      if (line.startsWith("Description:")) {
        result.push(
          "Description: Desktop client for WhatsApp Web with themes and multiple account support."
        );
        result.push(
          " Altus is an Electron-based WhatsApp Web client with multiple account"
        );
        result.push(
          " support, custom themes, native notifications and system tray integration."
        );

        while (
          index + 1 < lines.length &&
          /^[ \t]/.test(lines[index + 1])
        ) {
          index += 1;
        }
        continue;
      }

      result.push(line);
    }

    return result.join("\n");
  }

  private async enhanceDebPackage(
    debPath: string,
    makeDir: string,
    appVersion: string
  ): Promise<string> {
    const stagingPath = path.resolve(makeDir, "deb", "package-root");
    const debianVersion = `${appVersion}-${DEBIAN_REVISION}`;

    await fs.remove(stagingPath);
    await fs.ensureDir(stagingPath);
    await execFileAsync("dpkg-deb", ["-R", debPath, stagingPath]);

    const appDirectory = path.join(stagingPath, "opt", "Altus");
    const appExecutable = path.join(appDirectory, "Altus");
    await fs.chmod(appDirectory, 0o755);
    await fs.chmod(appExecutable, 0o755);

    const desktopDirectory = path.join(
      stagingPath,
      "usr",
      "share",
      "applications"
    );
    const iconDirectory = path.join(
      stagingPath,
      "usr",
      "share",
      "icons",
      "hicolor",
      "256x256",
      "apps"
    );
    const metainfoDirectory = path.join(
      stagingPath,
      "usr",
      "share",
      "metainfo"
    );
    const binDirectory = path.join(stagingPath, "usr", "bin");

    await Promise.all([
      fs.ensureDir(desktopDirectory),
      fs.ensureDir(iconDirectory),
      fs.ensureDir(metainfoDirectory),
      fs.ensureDir(binDirectory),
    ]);

    await Promise.all([
      fs.remove(path.join(desktopDirectory, "Altus.desktop")),
      fs.remove(path.join(iconDirectory, "Altus.png")),
    ]);

    const desktopFileName = `${APP_ID}.desktop`;
    const desktopFile = `[Desktop Entry]\nName=Altus\nGenericName=WhatsApp Desktop Client\nComment=Desktop client for WhatsApp Web with themes and multiple account support\nExec=/usr/bin/altus %U\nTerminal=false\nType=Application\nIcon=${APP_ID}\nStartupWMClass=Altus\nStartupNotify=true\nMimeType=x-scheme-handler/whatsapp;\nCategories=Network;InstantMessaging;\nKeywords=WhatsApp;Messaging;Chat;\nX-GNOME-UsesNotifications=true\n`;

    await fs.writeFile(
      path.join(desktopDirectory, desktopFileName),
      desktopFile,
      { mode: 0o644 }
    );

    const sourceIcon = path.resolve(
      __dirname,
      "..",
      "public",
      "assets",
      "icons",
      "icon.png"
    );
    await fs.copyFile(
      sourceIcon,
      path.join(iconDirectory, `${APP_ID}.png`)
    );

    const metainfo = `<?xml version="1.0" encoding="UTF-8"?>\n<component type="desktop-application">\n  <id>${APP_ID}</id>\n  <name>Altus</name>\n  <summary>Desktop client for WhatsApp Web with themes and multiple account support</summary>\n  <metadata_license>CC0-1.0</metadata_license>\n  <project_license>GPL-3.0-only</project_license>\n  <description>\n    <p>Altus is an Electron-based WhatsApp Web client with multiple account support, custom themes, native notifications and system tray integration.</p>\n  </description>\n  <launchable type="desktop-id">${desktopFileName}</launchable>\n  <icon type="stock">${APP_ID}</icon>\n  <url type="homepage">https://github.com/danilostorm/altus</url>\n  <provides>\n    <binary>altus</binary>\n  </provides>\n  <categories>\n    <category>Network</category>\n    <category>InstantMessaging</category>\n  </categories>\n  <content_rating type="oars-1.1"/>\n</component>\n`;

    await fs.writeFile(
      path.join(metainfoDirectory, `${APP_ID}.metainfo.xml`),
      metainfo,
      { mode: 0o644 }
    );

    const lowercaseLauncher = path.join(binDirectory, "altus");
    await fs.remove(lowercaseLauncher);
    await fs.symlink("/opt/Altus/Altus", lowercaseLauncher);

    const controlPath = path.join(stagingPath, "DEBIAN", "control");
    const control = await fs.readFile(controlPath, "utf8");
    await fs.writeFile(
      controlPath,
      this.updateControlMetadata(control, debianVersion),
      "utf8"
    );

    await Promise.all([
      this.appendIconCacheRefresh(
        path.join(stagingPath, "DEBIAN", "postinst")
      ),
      this.appendIconCacheRefresh(path.join(stagingPath, "DEBIAN", "postrm")),
      this.ensureInstallDirectoryAccess(
        path.join(stagingPath, "DEBIAN", "postinst")
      ),
    ]);

    const architectureMatch = control.match(/^Architecture:\s*(.+)$/m);
    const architecture = architectureMatch?.[1]?.trim() || "amd64";
    const rebuiltPath = path.resolve(
      path.dirname(debPath),
      `altus_${debianVersion}_${architecture}.deb`
    );

    await fs.remove(rebuiltPath);
    await execFileAsync("dpkg-deb", [
      "--build",
      "--root-owner-group",
      stagingPath,
      rebuiltPath,
    ]);

    await fs.remove(debPath);
    await fs.remove(stagingPath);

    return rebuiltPath;
  }

  async make(options: MakerOptions): Promise<string[]> {
    const { makeDir, targetArch, forgeConfig, appName, packageJSON } = options;
    const executableName = forgeConfig.packagerConfig.executableName || appName;

    const outPath = path.resolve(makeDir, "deb");
    const tmpPath = path.resolve(makeDir, `deb/${targetArch}-tmp`);
    const result: Array<string> = [];

    await fs.emptyDir(tmpPath);
    await fs.emptyDir(outPath);
    await fs.copy(options.dir, tmpPath);

    const output = await buildForge(
      { dir: tmpPath },
      {
        linux: [`deb:${targetArch}`],
        config: {
          ...CommonConfig,
          icon: path.resolve(
            __dirname,
            "..",
            "public",
            "assets",
            "icons",
            "icon.png"
          ),
          linux: {
            executableName,
            category: "Network;InstantMessaging",
            desktop: {
              entry: {
                Name: "Altus",
                Comment:
                  "Desktop client for WhatsApp Web with themes and multiple account support",
                Categories: "Network;InstantMessaging;",
                StartupWMClass: "Altus",
                Terminal: "false",
                Type: "Application",
              },
            },
          },
          deb: {
            priority: "optional",
          },
          publish: null,
        },
      }
    );

    for (const file of output) {
      const enhancedFile = await this.enhanceDebPackage(
        file,
        makeDir,
        packageJSON.version
      );
      const filePath = path.resolve(makeDir, path.basename(enhancedFile));

      if (enhancedFile !== filePath) {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
        }
        await fs.move(enhancedFile, filePath);
      }

      result.push(filePath);
    }

    await fs.remove(tmpPath);
    await fs.remove(outPath);
    await fs.remove(path.resolve(makeDir, "deb/make"));

    return result;
  }
}
