; IExpress 自解压安装包配置 —— 用于把 scripts\ 打成 WorkDaddy-Setup.exe
; 用法：iexpress /N /Q setup.sed    （由 make-setup.cmd 调用，自动填充源目录占位符）
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimationHandler=1
UseCustomHeader=0
UseCustomFooter=0
MaxExtractTime=2147483647

[SourceFiles]
SourceFiles0=__SCRIPTS_DIR__

[SourceFiles0]
%FILE0%=

[Strings]
AppName=WorkDaddy
AppVer=__VERSION__
AppComments=WorkDaddy – WorkBuddy 增强工具（Windows 安装包）
AppURL=
InstallProgram=%comspec% /d /c install-win.cmd
