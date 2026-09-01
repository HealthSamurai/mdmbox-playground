import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator
} from "@health-samurai/react-components";
import { Home } from "lucide-react";
import { Link } from "react-router";
import React from "react";

export interface MdmBreadcrumbItem {
    title: string;
    link?: string;
}

export interface MdmBreadcrumbsProps {
    items: MdmBreadcrumbItem[];
}

export function MdmBreadcrumbs({ items }: MdmBreadcrumbsProps) {
    return (
        <Breadcrumb>
            <BreadcrumbList>
                <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                        <Link to="/patients" aria-label="Home" className="flex items-center text-muted-foreground hover:text-foreground">
                            <Home className="h-4 w-4" />
                        </Link>
                    </BreadcrumbLink>
                </BreadcrumbItem>
                {items.map((crumb, index) => (
                    <React.Fragment key={crumb.title}>
                        <BreadcrumbSeparator>/</BreadcrumbSeparator>
                        <BreadcrumbItem>
                            {index === items.length - 1 ? (
                                <BreadcrumbPage style={{ color: '#1D2331', fontSize: '14px', fontWeight: 400 }}>{crumb.title}</BreadcrumbPage>
                            ) : (
                                crumb.link ? <BreadcrumbLink asChild style={{ backgroundColor: '#F4F5F6' }}>
                                    <a href={crumb.link}>{crumb.title}</a>
                                </BreadcrumbLink> : <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                            )}
                        </BreadcrumbItem>
                    </React.Fragment>
                ))}
            </BreadcrumbList>
        </Breadcrumb>
    );
}