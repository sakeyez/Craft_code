param([string]$Title = 'CraftCode Native Game Fixture')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.ClientSize = New-Object System.Drawing.Size(640, 480)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(300, 200)
$form.BackColor = [System.Drawing.Color]::Black
$form.KeyPreview = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = 'Native fixture'
$label.ForeColor = [System.Drawing.Color]::White
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$form.Controls.Add($label)

[System.Windows.Forms.Application]::Run($form)
