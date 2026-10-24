{
  "targets": [
    {
      "target_name": "screen_sharing_win32",
      "include_dirs": ["src"],
      "defines": [
        "NAPI_VERSION=8",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN",
        "UNICODE",
        "_UNICODE"
      ],
      "sources": [
        "src/addon.cc",
        "src/dxgi_capture.cc",
        "src/send_input.cc",
        "src/mf_probe.cc"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "d3d11.lib",
              "dxgi.lib",
              "user32.lib",
              "ole32.lib",
              "oleaut32.lib",
              "windowscodecs.lib",
              "mfplat.lib",
              "mfuuid.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": ["/std:c++17", "/utf-8"],
                "WarningLevel": 3
              }
            }
          }
        ]
      ]
    }
  ]
}
