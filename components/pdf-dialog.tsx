"use client"

import type React from "react"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type PdfDialogProps = {
  title: string
  trigger: React.ReactNode
  pdfSrc?: string // optional: when you have a real PDF
  imageSrc?: string // fallback preview (PNG/JPG)
}

export function PdfDialog({ title, trigger, pdfSrc, imageSrc }: PdfDialogProps) {
  console.log({ pdfSrc, imageSrc })
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-4xl w-[96vw]">
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>

        <div className="relative h-[70vh] w-full overflow-hidden rounded border bg-white">
          {pdfSrc ? (
            <object data={pdfSrc} type="application/pdf" className="h-full w-full">
              <iframe src={pdfSrc} className="h-full w-full" title={title} />
            </object>
          ) : imageSrc ? (
            <img
              src={imageSrc || "/placeholder.svg"}
              alt={`${title} preview`}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No preview available
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {pdfSrc && (
            <Button  asChild variant="secondary">
              <a href={pdfSrc} target="_blank" rel="noopener noreferrer">
                Open in new tab
              </a>
            </Button>
          )}
          {(pdfSrc || imageSrc) && (
            <Button asChild>
              <a href={pdfSrc || imageSrc!} download>
                Download
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
