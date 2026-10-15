// Helper kecil Zenopod untuk macOS (dibangun di GitHub Actions, ikut di dalam .app).
//
//   zenopod-helper ocr <file.png>   → {"text": "...", "lang": "auto"}  atau {"error": "..."}
//
// OCR memakai Vision framework bawaan macOS, offline.

import Foundation
import Vision
import AppKit

func reply(_ object: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

func ocr(_ path: String) -> Never {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        reply(["error": "Gambar tidak bisa dibuka"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    } else {
        request.recognitionLanguages = ["en-US"]
    }
    do {
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    } catch {
        reply(["error": error.localizedDescription])
    }
    // Urutkan dari atas ke bawah (koordinat Vision: 0 di bawah).
    let observations = (request.results ?? []).sorted { $0.boundingBox.minY > $1.boundingBox.minY }
    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
    reply(["text": lines.joined(separator: "\n"), "lang": "auto"])
}

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "ocr" else {
    reply(["error": "Pakai: zenopod-helper ocr <file>"])
}
ocr(args[2])
