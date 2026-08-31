const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'ProceduralTerrains',
    icon: path.resolve(__dirname, 'electron/assets/icon.ico'),
    extraResource: [path.resolve(__dirname, 'dist')],
    // The packaged renderer is the Vite output in extraResource. Keeping the
    // source tree and development-only npm graph out of the executable makes
    // the portable build deterministic and avoids carrying the editor repo.
    ignore: (filePath) => {
      // Electron Packager gives ignore callbacks POSIX-like paths rooted at
      // the application (`/package.json`) on Windows as well as absolute paths.
      const relative = /^[\\/]/.test(filePath)
        ? filePath.replace(/^[\\/]+/, '')
        : path.relative(__dirname, filePath);
      if (!relative) return false;
      const firstSegment = relative.replace(/\\/g, '/').split('/')[0];
      return !['electron', 'dist', 'package.json', 'package-lock.json'].includes(firstSegment)
        && relative !== 'package.json'
        && relative !== 'package-lock.json';
    },
    win32metadata: {
      CompanyName: 'ZyFou',
      FileDescription: 'Procedural Terrains',
      OriginalFilename: 'ProceduralTerrains.exe',
      ProductName: 'Procedural Terrains',
      InternalName: 'ProceduralTerrains',
      LegalCopyright: 'Copyright © 2026 ZyFou',
    },
  },
};
