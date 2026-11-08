<div class="LecternCard" data-lectern-uuid="{@uuid}">
    <xsl:if test="@pages"><xsl:attribute name="data-lectern-pages"><xsl:value-of select="@pages"/></xsl:attribute></xsl:if>
    <xsl:if test="@sheets"><xsl:attribute name="data-lectern-sheets"><xsl:value-of select="@sheets"/></xsl:attribute></xsl:if>
    <span class="LecternCard-icon"><i class="fas fa-file" aria-hidden="true"></i></span>
    <span class="LecternCard-info">
        <span class="LecternCard-name">{TEXT1}</span>
        <span class="LecternCard-meta"><xsl:value-of select="@size"/></span>
    </span>
    <span class="LecternCard-actions">
        <span class="Button Button--icon hasIcon LecternCard-download" data-fof-upload-download-uuid="{@uuid}"><i class="icon fas fa-download" aria-hidden="true"></i></span>
    </span>
</div>
