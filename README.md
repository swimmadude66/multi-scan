# Multi-Scan

*a quick and dirty multi-threaded file examiner*

## Backstory
I am going through the process of consolidating certain filetypes on to specific disks in one of my windows PCs. In order to make room, I wanted to find the biggest space hogs on each disk and see if they could be moved/deleted. My normal go-to for situations like this is [WinDirStat](https://windirstat.net/) (which I still highly recommend), but the single-threaded ops were taking a lifetime.

While I waited on the scan of my data drive to complete, I whipped together this script to generate a json representation of a given disk (or really any folder) utilizing the native mult-cpu support in nodejs. 

This project is probably not very useful. It was really just a challenge to work more on multithreading. However, it works pretty well for a 1-day project, so I'm publishing it to look back on for future multi-threading projects.