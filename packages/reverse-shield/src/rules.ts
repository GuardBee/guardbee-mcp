export type Severity = "critical" | "high" | "medium" | "low";

export type RuleCategory =
  | "source-exposure"
  | "obfuscation"
  | "debug-surface"
  | "tamper-resistance"
  | "binary-hardening"
  | "secrets-in-artifact";

export type TargetKind = "web" | "electron" | "android" | "ios" | "native" | "dotnet" | "framework";

export interface Rule {
  id: string;
  name: string;
  target: TargetKind;
  category: RuleCategory;
  severity: Severity;
  /** What an analyst (or an agent driving a reverse-engineering MCP) gets out of this. */
  exposes: string;
  recommendation: string;
}

/**
 * Every check this package runs. A finding carries one of these ids; the
 * severity here is the default and a few checks raise or lower it from what
 * they actually find (a source map that embeds the original sources is worse
 * than one that only maps positions).
 */
export const RULES: Rule[] = [
  // ── Web / JavaScript bundles ───────────────────────────────────────────────
  {
    id: "sourcemap_embeds_source",
    name: "Source map ships the original source code",
    target: "web",
    category: "source-exposure",
    severity: "critical",
    exposes: "The complete pre-build source (file names, comments, un-minified code) via the map's sourcesContent.",
    recommendation: "Do not deploy .map files. Generate them as 'hidden' source maps (webpack devtool: 'hidden-source-map', Vite build.sourcemap: 'hidden') and upload them only to your error tracker, or strip sourcesContent.",
  },
  {
    id: "sourcemap_shipped",
    name: "Source map shipped with the build",
    target: "web",
    category: "source-exposure",
    severity: "high",
    exposes: "Original file paths, symbol names and line structure, which turn minified code back into readable modules.",
    recommendation: "Remove .map files from the deployed output, or serve them only to authenticated error-tracking infrastructure.",
  },
  {
    id: "sourcemap_inline",
    name: "Inline source map embedded in the bundle",
    target: "web",
    category: "source-exposure",
    severity: "high",
    exposes: "A base64 source map inside the JavaScript itself, so every visitor downloads it.",
    recommendation: "Switch the production build away from inline source maps (webpack devtool 'inline-*', Vite build.sourcemap: 'inline').",
  },
  {
    id: "sourcemap_reference",
    name: "Bundle points at a source map URL",
    target: "web",
    category: "source-exposure",
    severity: "low",
    exposes: "Where the map lives. If that URL is ever reachable, the original sources are one request away.",
    recommendation: "Build with hidden source maps so the //# sourceMappingURL comment is not emitted.",
  },
  {
    id: "sourcemap_publicly_reachable",
    name: "Source map is publicly downloadable",
    target: "web",
    category: "source-exposure",
    severity: "high",
    exposes: "The live site serves the map for its own bundle to anyone who asks.",
    recommendation: "Block *.map at the CDN/web server or stop uploading them with the static assets.",
  },
  {
    id: "eval_devtool_bundle",
    name: "Development-style eval bundle",
    target: "web",
    category: "source-exposure",
    severity: "high",
    exposes: "Each module wrapped in eval() with its original path (//# sourceURL=webpack://...), effectively a source tree.",
    recommendation: "Build in production mode; eval-based devtool settings are for local development only.",
  },
  {
    id: "unminified_bundle",
    name: "Bundle is not minified",
    target: "web",
    category: "obfuscation",
    severity: "medium",
    exposes: "Readable identifiers, comments and control flow without any deobfuscation step.",
    recommendation: "Enable minification (Terser/esbuild/SWC) with identifier mangling for production builds. Consider javascript-obfuscator for code that encodes business logic you need to protect.",
  },
  {
    id: "dev_build_framework",
    name: "Framework development build in production",
    target: "web",
    category: "debug-surface",
    severity: "medium",
    exposes: "Component names, prop types and dev-only warnings that map the UI structure and state.",
    recommendation: "Set NODE_ENV=production (or the framework's production flag) for the build so the development runtime is tree-shaken out.",
  },
  {
    id: "bundle_secret",
    name: "Credential embedded in shipped code",
    target: "web",
    category: "secrets-in-artifact",
    severity: "high",
    exposes: "A working credential that anyone who unpacks the artifact can lift, with no reverse engineering skill needed.",
    recommendation: "Move the secret server-side and rotate it now; anything in a client bundle, app package or binary must be considered public.",
  },
  {
    id: "internal_endpoint",
    name: "Internal or non-production endpoint in shipped code",
    target: "web",
    category: "debug-surface",
    severity: "low",
    exposes: "Hosts behind the public surface (localhost, private IPs, *.internal, staging) that hint at infrastructure worth probing.",
    recommendation: "Inject environment-specific URLs at build time and make sure production builds only contain production endpoints.",
  },

  {
    id: "wasm_debug_info",
    name: "WebAssembly module ships DWARF debug info",
    target: "web",
    category: "source-exposure",
    severity: "high",
    exposes: "Source file names, line tables, types and local variable names (.debug_* sections); browser devtools and wasm decompilers show the original functions next to the code.",
    recommendation: "Build release modules without debug info (Emscripten: no -g, or -gseparate-dwarf; Rust: debug = false for the release profile) or strip it: wasm-opt --strip-debug / wasm-strip.",
  },
  {
    id: "wasm_name_section",
    name: "WebAssembly module keeps its function names",
    target: "web",
    category: "obfuscation",
    severity: "medium",
    exposes: "The `name` section maps every function to its source name, so a decompiled module (wasm2c, Ghidra, devtools) reads like the original instead of func123.",
    recommendation: "Strip the name section in release builds: wasm-opt --strip-debug (or --strip-producers), wasm-strip, Rust strip = true / wasm-bindgen --remove-name-section, Emscripten without --profiling-funcs.",
  },
  // ── Electron ──────────────────────────────────────────────────────────────
  {
    id: "electron_app_unpacked",
    name: "Electron app code shipped as plain files",
    target: "electron",
    category: "source-exposure",
    severity: "high",
    exposes: "The whole app as a readable resources/app directory that can be edited in place.",
    recommendation: "Package the app into app.asar (electron-builder/forge do this by default) and enable the OnlyLoadAppFromAsar and EmbeddedAsarIntegrityValidation fuses.",
  },
  {
    id: "electron_fuse_run_as_node",
    name: "Electron RunAsNode fuse enabled",
    target: "electron",
    category: "tamper-resistance",
    severity: "high",
    exposes: "ELECTRON_RUN_AS_NODE=1 turns the signed app binary into a plain Node.js runtime that runs any script with the app's identity and permissions.",
    recommendation: "Flip the RunAsNode fuse off with @electron/fuses (or electron-builder/forge fuse config).",
  },
  {
    id: "electron_fuse_inspect_args",
    name: "Electron Node inspector arguments allowed",
    target: "electron",
    category: "debug-surface",
    severity: "high",
    exposes: "--inspect / --inspect-brk attach a full debugger to the main process: breakpoints, memory and live code inside the shipped app.",
    recommendation: "Flip the EnableNodeCliInspectArguments fuse off.",
  },
  {
    id: "electron_fuse_node_options",
    name: "Electron honours NODE_OPTIONS",
    target: "electron",
    category: "tamper-resistance",
    severity: "medium",
    exposes: "NODE_OPTIONS=--require ./hook.js injects code into the main process before the app starts.",
    recommendation: "Flip the EnableNodeOptionsEnvironmentVariable fuse off.",
  },
  {
    id: "electron_fuse_asar_integrity_off",
    name: "Electron ASAR integrity validation off",
    target: "electron",
    category: "tamper-resistance",
    severity: "medium",
    exposes: "app.asar can be unpacked, patched and repacked without the signed binary noticing.",
    recommendation: "Enable the EnableEmbeddedAsarIntegrityValidation fuse (requires a recent electron-builder/forge that writes the integrity hash).",
  },
  {
    id: "electron_fuse_load_outside_asar",
    name: "Electron may load the app from outside the ASAR",
    target: "electron",
    category: "tamper-resistance",
    severity: "medium",
    exposes: "Dropping a resources/app folder next to app.asar replaces the app code without touching the archive.",
    recommendation: "Enable the OnlyLoadAppFromAsar fuse.",
  },

  // ── Android ───────────────────────────────────────────────────────────────
  {
    id: "apk_debuggable",
    name: "APK is debuggable",
    target: "android",
    category: "debug-surface",
    severity: "critical",
    exposes: "Any device can attach a Java/native debugger, run-as into the app's private data and inspect it live.",
    recommendation: "Ship a release build; never set android:debuggable=\"true\" (it is set automatically on debug builds).",
  },
  {
    id: "apk_no_obfuscation",
    name: "App classes are not obfuscated",
    target: "android",
    category: "obfuscation",
    severity: "high",
    exposes: "jadx output that reads like the original Kotlin/Java: class, method and field names intact.",
    recommendation: "Enable R8 for the release build (isMinifyEnabled = true, isShrinkResources = true) and keep rules only for what reflection needs.",
  },
  {
    id: "apk_js_bundle_plaintext",
    name: "React Native bundle shipped as plain JavaScript",
    target: "android",
    category: "source-exposure",
    severity: "high",
    exposes: "assets/index.android.bundle is readable JavaScript containing the app's business logic.",
    recommendation: "Enable Hermes so the bundle ships as bytecode, and minify it.",
  },
  {
    id: "apk_unsigned",
    name: "APK is not signed",
    target: "android",
    category: "tamper-resistance",
    severity: "high",
    exposes: "There is no signature to break, so a modified copy is indistinguishable from the original.",
    recommendation: "Sign release builds with APK Signature Scheme v2 or later (Play App Signing does this for bundles).",
  },
  {
    id: "apk_v1_only_signature",
    name: "APK signed with JAR (v1) scheme only",
    target: "android",
    category: "tamper-resistance",
    severity: "medium",
    exposes: "v1 signatures do not cover the whole file (Janus, CVE-2017-13156), so repackaging tricks stay possible on older devices.",
    recommendation: "Enable v2/v3 signing (default in current Android Gradle Plugin) and raise minSdk where you can.",
  },
  {
    id: "apk_allow_backup",
    name: "App data can be pulled through backup",
    target: "android",
    category: "debug-surface",
    severity: "medium",
    exposes: "adb backup / device transfer copies the app's private databases, preferences and tokens for offline analysis.",
    recommendation: "Set android:allowBackup=\"false\", or define dataExtractionRules/fullBackupContent that exclude sensitive files.",
  },
  {
    id: "apk_test_only",
    name: "APK marked testOnly",
    target: "android",
    category: "debug-surface",
    severity: "low",
    exposes: "A test build left in a distributed package; such builds usually carry other debug affordances too.",
    recommendation: "Distribute release builds only; testOnly is set by the IDE for run configurations.",
  },

  // ── iOS ───────────────────────────────────────────────────────────────────
  {
    id: "ios_debug_build",
    name: "iOS app built with the Debug configuration",
    target: "ios",
    category: "debug-surface",
    severity: "high",
    exposes: "Unoptimised code in <App>.debug.dylib with full symbols and SwiftUI preview stubs: the closest thing to source a binary can be.",
    recommendation: "Archive with the Release configuration (Product > Archive, or xcodebuild -configuration Release) before distributing.",
  },
  {
    id: "ios_js_bundle_plaintext",
    name: "React Native bundle shipped as plain JavaScript (iOS)",
    target: "ios",
    category: "source-exposure",
    severity: "high",
    exposes: "main.jsbundle is readable JavaScript containing the app's business logic.",
    recommendation: "Enable Hermes for iOS (the default in recent React Native) so the bundle ships as bytecode.",
  },
  {
    id: "ios_development_profile",
    name: "IPA signed with a development provisioning profile",
    target: "ios",
    category: "debug-surface",
    severity: "medium",
    exposes: "get-task-allow in the embedded profile: on registered devices the app can be attached to with a debugger.",
    recommendation: "Export with an App Store, Ad Hoc or Enterprise distribution profile; development profiles are for local testing.",
  },

  {
    id: "ios_dsym_shipped",
    name: "Debug symbols (.dSYM) shipped inside the app bundle",
    target: "ios",
    category: "source-exposure",
    severity: "high",
    exposes: "Full DWARF debug info for the executable: function names, source file paths and line numbers, the same as an unstripped Debug build.",
    recommendation: "Keep .dSYM bundles out of the app: upload them to your crash reporter from the archive, and remove any Copy Files / script phase that copies them into the bundle.",
  },
  // ── Native binaries (ELF, Mach-O, PE) ──────────────────────────────────────
  {
    id: "native_debug_info",
    name: "Debug information shipped in the binary",
    target: "native",
    category: "source-exposure",
    severity: "high",
    exposes: "DWARF/PDB data maps machine code back to source files, line numbers, types and local variable names.",
    recommendation: "Strip debug info from release artifacts (strip -S / -g, dsymutil + strip on macOS, /DEBUG with a separate PDB on Windows) and keep symbols in a private symbol server.",
  },
  {
    id: "native_symbols_not_stripped",
    name: "Symbol table not stripped",
    target: "native",
    category: "obfuscation",
    severity: "medium",
    exposes: "Internal function names label the disassembly, which is most of the work a reverse engineer does by hand.",
    recommendation: "Strip local symbols in release builds (strip, -Wl,-s, -Wl,-dead_strip -Wl,-x on macOS) and build with -fvisibility=hidden.",
  },
  {
    id: "native_debuggable_entitlement",
    name: "get-task-allow entitlement present",
    target: "native",
    category: "debug-surface",
    severity: "high",
    exposes: "macOS lets any process of the same user attach a debugger (lldb) and read the app's memory.",
    recommendation: "Sign release builds without com.apple.security.get-task-allow (Xcode adds it only to Debug).",
  },
  {
    id: "native_no_hardened_runtime",
    name: "macOS executable without the Hardened Runtime",
    target: "native",
    category: "tamper-resistance",
    severity: "medium",
    exposes: "DYLD_INSERT_LIBRARIES injection and debugger attachment are not blocked by the OS.",
    recommendation: "Sign with --options runtime (required for notarization) and avoid the disable-library-validation / allow-dyld-environment-variables exceptions.",
  },
  {
    id: "native_injection_entitlement",
    name: "Entitlement that re-opens code injection",
    target: "native",
    category: "tamper-resistance",
    severity: "medium",
    exposes: "disable-library-validation or allow-dyld-environment-variables lets unsigned dylibs load into the process.",
    recommendation: "Remove the entitlement; if a plug-in model needs it, load plug-ins in a separate helper process.",
  },
  {
    id: "native_unsigned",
    name: "Binary is not code-signed",
    target: "native",
    category: "tamper-resistance",
    severity: "medium",
    exposes: "Patched copies of the binary run without any OS warning.",
    recommendation: "Code-sign release binaries (Developer ID on macOS, Authenticode on Windows).",
  },
  {
    id: "native_adhoc_signed",
    name: "Binary is only ad-hoc signed",
    target: "native",
    category: "tamper-resistance",
    severity: "low",
    exposes: "An ad-hoc signature has no identity; anyone can re-sign a patched copy the same way.",
    recommendation: "Sign with a Developer ID certificate and notarize.",
  },
  {
    id: "native_build_path_leak",
    name: "Build machine path embedded in the binary",
    target: "native",
    category: "debug-surface",
    severity: "low",
    exposes: "The PDB path reveals the build host's directory layout, user name and project structure.",
    recommendation: "Use /PDBALTPATH:%_PDB% (MSVC) or -fdebug-prefix-map / -ffile-prefix-map to strip build paths.",
  },
  {
    id: "native_no_pie",
    name: "Executable is not position-independent",
    target: "native",
    category: "binary-hardening",
    severity: "medium",
    exposes: "Fixed load addresses make every address found during analysis directly reusable in an exploit.",
    recommendation: "Build with -fPIE -pie (ELF), keep MH_PIE on macOS, and /DYNAMICBASE on Windows.",
  },
  {
    id: "native_no_nx",
    name: "Stack/data not marked non-executable",
    target: "native",
    category: "binary-hardening",
    severity: "medium",
    exposes: "Injected code on the stack or heap can run directly.",
    recommendation: "Link with -z noexecstack (ELF) or /NXCOMPAT (Windows).",
  },
  {
    id: "native_no_relro",
    name: "No RELRO",
    target: "native",
    category: "binary-hardening",
    severity: "low",
    exposes: "The GOT stays writable, a classic target for redirecting calls after memory corruption.",
    recommendation: "Link with -Wl,-z,relro,-z,now.",
  },
  {
    id: "native_no_stack_canary",
    name: "No stack protector",
    target: "native",
    category: "binary-hardening",
    severity: "low",
    exposes: "Stack buffer overflows overwrite return addresses without detection.",
    recommendation: "Compile with -fstack-protector-strong.",
  },

  // ── Frameworks ────────────────────────────────────────────────────────────
  {
    id: "unity_il2cpp_metadata",
    name: "Unity IL2CPP metadata shipped in the clear",
    target: "framework",
    category: "source-exposure",
    severity: "high",
    exposes: "Il2CppDumper turns global-metadata.dat plus the native binary into every class, method, field and string literal of the game, with addresses.",
    recommendation: "Protect the metadata (encrypt global-metadata.dat with a Unity protection tool or a custom loader) and strip the IL2CPP binary; treat client logic as visible regardless.",
  },
  {
    id: "unity_mono_assemblies",
    name: "Unity game logic shipped as plain .NET assemblies",
    target: "framework",
    category: "obfuscation",
    severity: "high",
    exposes: "Assembly-CSharp.dll decompiles to the game's C# scripts with dnSpy/ILSpy, names included, and can be patched and repacked.",
    recommendation: "Switch the scripting backend to IL2CPP for release builds, or run an obfuscator over Assembly-CSharp.dll.",
  },
  {
    id: "python_pyinstaller_bundle",
    name: "Python app packaged with PyInstaller",
    target: "framework",
    category: "source-exposure",
    severity: "high",
    exposes: "The bundled .pyc files extract with pyinstxtractor and decompile back to Python source.",
    recommendation: "Compile the code instead (Nuitka, Cython for sensitive modules) or protect it (PyArmor) before packaging; keep secrets server-side.",
  },
  {
    id: "java_not_obfuscated",
    name: "Java application classes are not obfuscated",
    target: "framework",
    category: "obfuscation",
    severity: "high",
    exposes: "Any Java decompiler (CFR, Fernflower) gives back the classes with their original names.",
    recommendation: "Run ProGuard (or another obfuscator) in the release build and keep -keep rules to what reflection and frameworks need.",
  },

  {
    id: "flutter_not_obfuscated",
    name: "Flutter app built without Dart obfuscation",
    target: "framework",
    category: "obfuscation",
    severity: "high",
    exposes: "Class, method and library names of the Dart code in the AOT snapshot (libapp.so / App.framework); blutter and reFlutter rebuild the app's structure and hook points from them.",
    recommendation: "Build releases with flutter build apk|appbundle|ipa --obfuscate --split-debug-info=<dir>, and keep <dir> private for symbolicating crashes.",
  },
  // ── .NET ──────────────────────────────────────────────────────────────────
  {
    id: "dotnet_not_obfuscated",
    name: ".NET assembly is not obfuscated",
    target: "dotnet",
    category: "obfuscation",
    severity: "high",
    exposes: "ILSpy/dnSpy decompile it to C# that is close to the original, names included.",
    recommendation: "Run an obfuscator in the release pipeline (e.g. Obfuscar, ConfuserEx 2, a commercial protector) or publish with NativeAOT where the app allows it.",
  },
  {
    id: "dotnet_embedded_pdb",
    name: ".NET assembly embeds its PDB",
    target: "dotnet",
    category: "source-exposure",
    severity: "high",
    exposes: "Embedded portable PDB gives decompilers local variable names, source paths and sometimes the source itself.",
    recommendation: "Set <DebugType>none</DebugType> (or portable, shipped separately) for Release, and do not set EmbedAllSources.",
  },
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function getRule(id: string): Rule {
  const rule = RULE_BY_ID.get(id);
  if (!rule) throw new Error(`Unknown rule: ${id}`);
  return rule;
}
